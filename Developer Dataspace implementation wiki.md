# Eclipse Dataspace Components (EDC) — Deep Wiki

> **Source:** [Eclipse EDC Contributors Manual](https://eclipse-edc.github.io/documentation/for-contributors/)
> **Audience:** Software developers contributing to or building on top of the EDC project.

---

## Table of Contents

1. [Introduction & Intended Audience](#1-introduction--intended-audience)
2. [Getting Started](#2-getting-started)
  - 2.1 [Prerequisites](#21-prerequisites)
  - 2.2 [Terminology](#22-terminology)
  - 2.3 [Architectural & Coding Principles](#23-architectural--coding-principles)
3. [The Control Plane](#3-the-control-plane)
  - 3.1 [Entities](#31-entities)
    - 3.1.1 [Assets](#311-assets)
    - 3.1.2 [Policies](#312-policies)
    - 3.1.3 [Policy vs PolicyDefinition](#313-policy-vs-policydefinition)
    - 3.1.4 [Policy Scopes and Bindings](#314-policy-scopes-and-bindings)
    - 3.1.5 [Policy Evaluation Functions](#315-policy-evaluation-functions)
    - 3.1.6 [Advanced Policy Concepts](#316-advanced-policy-concepts)
    - 3.1.7 [Bundled Policy Functions](#317-bundled-policy-functions)
    - 3.1.8 [Contract Definitions](#318-contract-definitions)
    - 3.1.9 [Contract Negotiations](#319-contract-negotiations)
    - 3.1.10 [Contract Agreements](#3110-contract-agreements)
    - 3.1.11 [Catalog](#3111-catalog)
    - 3.1.12 [Transfer Processes](#3112-transfer-processes)
    - 3.1.13 [Endpoint Data References (EDRs)](#3113-endpoint-data-references-edrs)
    - 3.1.14 [Querying with QuerySpec and Criterion](#3114-querying-with-queryspec-and-criterion)
  - 3.2 [Policy Monitor](#32-policy-monitor)
  - 3.3 [Protocol Extensions (DSP)](#33-protocol-extensions-dsp)
4. [PostgreSQL Persistence](#4-postgresql-persistence)
5. [The Data Plane](#5-the-data-plane)
  - 5.1 [DataPlaneManager](#51-dataplane-manager)
  - 5.2 [Data Plane Framework (DPF)](#52-data-plane-framework-dpf)
  - 5.3 [Writing Custom Source/Sink](#53-writing-custom-sourcesink)
6. [Runtime](#6-runtime)
  - 6.1 [JSON-LD Serialization](#61-json-ld-serialization)
  - 6.2 [Programming Primitives](#62-programming-primitives)
  - 6.3 [Extension Model](#63-extension-model)
  - 6.4 [Dependency Injection Deep Dive](#64-dependency-injection-deep-dive)
  - 6.5 [Service Layers](#65-service-layers)
7. [Development Best Practices](#7-development-best-practices)
  - 7.1 [Testing](#71-testing)
  - 7.2 [Logging](#72-logging)
  - 7.3 [Security Recommendations](#73-security-recommendations)
  - 7.4 [General Recommendations](#74-general-recommendations)
  - 7.5 [Custom Validation Framework](#75-custom-validation-framework)
  - 7.6 [Instrumentation with Micrometer](#76-instrumentation-with-micrometer)

---

## 1. Introduction & Intended Audience

The Eclipse Dataspace Components (EDC) project provides a modular, extensible platform for building **dataspace connectors** — software components that allow organizations to share data under well-defined access and usage control rules. This wiki is aimed at **software developers who already understand EDC from an adopter perspective** and want to contribute code or deeply understand the internals.

EDC is not a monolith. It is a **plugin-based, asynchronous Java platform** where almost every behavior can be swapped out, extended, or replaced via the extension model.

---

## 2. Getting Started

### 2.1 Prerequisites

**Required knowledge:**

- JSON and JSON-LD
- HTTP/REST
- Relational databases (especially PostgreSQL) and transaction management
- Git and git workflows

**Required tooling:**

- Java Development Kit 17+
- Gradle 8+
- A POSIX-compliant shell (bash, zsh, etc.)
- CLI tools: `curl`, `git`

> Windows is **not** a supported OS. Use WSL2 or a Linux VM if required.

---

### 2.2 Terminology


| Term             | Definition                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Runtime**      | A Java process executing code written in the EDC programming model (e.g., a control plane process).               |
| **Distribution** | A specific combination of EDC modules compiled into a runnable form (fat JAR, Docker image, etc.).                |
| **Launcher**     | A runnable Java module that pulls in other modules to form a distribution. Used synonymously with "distribution". |
| **Connector**    | A control plane runtime plus one or more data plane runtimes. Sometimes used interchangeably with "distribution". |
| **Consumer**     | A dataspace participant who wants to ingest data under access rules imposed by the provider.                      |
| **Provider**     | A dataspace participant who offers data assets under a set of access rules.                                       |


---

### 2.3 Architectural & Coding Principles

These are the foundational principles baked into every part of EDC:

**Asynchrony:** All external mutations of internal data structures happen asynchronously. REST API calls to trigger mutations (e.g., starting a contract negotiation) return immediately (e.g., with just an ID); the actual state changes happen cyclically in the background. EDC favors reliability over low latency.

**Single-thread processing:** The control plane is built around a set of **sequential state machines** that use pessimistic locking to guard against race conditions in clustered environments.

**Idempotency:** Requests that do not trigger a mutation (e.g., GET requests) are idempotent. Resource provisioning operations are also designed to be idempotent.

**Error-tolerance:** The control plane is designed to cope with transient errors (e.g., an unreachable communication partner) and will retry until the operation succeeds or is explicitly terminated.

**Simplicity and self-containment:** EDC is extremely cautious about adding third-party libraries to keep the platform fast, simple, and un-opinionated.

---

## 3. The Control Plane

The **control plane** is the "brain" of a connector. Its responsibilities include:

- Handling protocol (DSP) and API (Management API) requests
- Managing asynchronous internal processes via state machines
- Validating and enforcing policies
- Performing participant authentication
- Delegating data transfer to the data plane

The control plane **does not directly transfer data**. Its primary interaction point for operators/integrators is the **Management API**, located in `extensions/control-plane/api/management-api`.

---

### 3.1 Entities

#### 3.1.1 Assets

An **Asset** is a metadata container. It does not hold the actual data bytes — instead, it describes where data is physically located and provides metadata about it.

**Key components of an Asset:**

- `**properties`**: Public metadata visible to the dataspace (e.g., `contentType`, `version`, custom fields).
- `**privateProperties**`: Internal metadata that is **never serialized over DSP** (the dataspace protocol). Stored in the database but not exposed externally.
- `**dataAddress`**: A "pointer into the physical world" — describes where the data actually lives (e.g., an S3 bucket name/region, an HTTP URL). The schema of the `DataAddress` depends on the storage backend.

**Important notes:**

- Assets are **schemaless** beyond basic validation. Custom properties can be added freely.
- All properties are placed under the `edc` namespace by default unless a custom namespace is specified.
- **Never store credentials (passwords, tokens, keys) in `dataAddress` or `privateProperties`**. Always use a Vault/HSM and store only a reference alias.
- Assets are persisted in their **JSON-LD expanded form**. Queries must also use the expanded form.
- Well-known `edc` namespace properties: `id`, `description`, `version`, `name`, `contenttype`.
- UUIDs are recommended (not required) as `@id` values.

**Example minimal asset:**

```json
{
  "@context": { "edc": "https://w3id.org/edc/v0.0.1/ns/" },
  "@id": "79d9c360-476b-47e8-8925-0ffbeba5aec2",
  "properties": { "somePublicProp": "a very interesting value" },
  "privateProperties": { "secretKey": "never share this!" },
  "dataAddress": { "type": "HttpData", "baseUrl": "http://localhost:8080/test" }
}
```

---

#### 3.1.2 Policies

**Policies** are EDC's way of expressing conditions that must, may, or must not be satisfied in certain situations. They are used to express what requirements a subject (e.g., a communication partner) must fulfill to perform an action.

Policies are expressed using **ODRL (Open Digital Rights Language)** serialized as JSON-LD.

**Policy structure:**

- `**duty`** — a constraint that **MUST** be satisfied (obligation).
- `**permission`** — a constraint that **MAY** be satisfied.
- `**prohibition`** — a constraint that **MUST NOT** be satisfied.
- `**action`** — the type of action the rule applies to. In EDC, this is almost always `"use"`.
- `**constraint**` — a logical expression with:
  - `leftOperand`: the property key (e.g., `headquarter_location`)
  - `operator`: comparison operator
  - `rightOperand`: the value to compare against

**Supported operators:** `eq`, `neq`, `gt`, `geq`, `lt`, `leq`, `in`, `hasPart`, `isA`, `isAllOf`, `isAnyOf`, `isNoneOf`

**Example policy (requires EU HQ):**

```json
{
  "@context": { "edc": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "PolicyDefinition",
  "policy": {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type": "Set",
    "duty": [{
      "target": "http://example.com/asset:12345",
      "action": "use",
      "constraint": {
        "leftOperand": "headquarter_location",
        "operator": "eq",
        "rightOperand": "EU"
      }
    }]
  }
}
```

---

#### 3.1.3 Policy vs PolicyDefinition

EDC distinguishes between two related concepts:

- `**Policy**`: A value object containing rules. Used when exchanging policy data during contract negotiations (via DCAT objects). Does not necessarily have a persisted ID.
- `**PolicyDefinition**`: An entity that wraps a `Policy` with an `id` property, making it persistable and queryable. Used in contract definitions.

This distinction arises because DCAT (the catalog vocabulary) has no concept of offers, policies, or assets — so when deserializing DCAT objects, the `Policy#uid` cannot be reconstructed from the JSON-LD structure.

---

#### 3.1.4 Policy Scopes and Bindings

A **policy scope** (also called a *policy evaluation point*) is the specific "situation" in which a policy is evaluated. Scopes are static — they cannot be added dynamically at runtime.

**Defined scopes:**


| Scope                          | When Evaluated                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `contract.negotiation`         | Upon initial contract offer — ensures the consumer fulfills the contract policy.              |
| `transfer.process`             | Before starting a transfer — checks the contract agreement policy is still valid.             |
| `catalog`                      | When generating a catalog for a participant — determines what assets appear in their catalog. |
| `request.contract.negotiation` | On every request during inter-connector contract negotiation. (Internal use.)                 |
| `request.transfer.process`     | On every request during inter-connector transfer establishment. (Internal use.)               |
| `request.catalog`              | On incoming catalog requests. (Internal use.)                                                 |
| `provision.manifest.verify`    | During precondition check for resource provisioning. (Advanced use.)                          |
| `policy.monitor`               | Evaluated periodically by the Policy Monitor for running transfers.                           |


**Two types of bindings exist for each scope:**

1. **Scope-to-rule binding**: Filters which rules within a policy are "in scope" (i.e., relevant) — implemented via `RuleBindingRegistry`.
2. **Scope-to-function binding**: Registers the Java function that actually evaluates those rules — implemented via `PolicyEngine`.

---

#### 3.1.5 Policy Evaluation Functions

**Policy evaluation functions** are the runtime enforcement mechanism for policies. They are pieces of Java code that receive the operator, the `rightOperand`, the rule, and a `PolicyContext`, and return a boolean indicating whether the policy is satisfied.

**Interface to implement:** `org.eclipse.edc.policy.engine.spi.AtomicConstraintFunction`

**Example — evaluating a headquarter location constraint:**

```java
public class HeadquarterFunction implements AtomicConstraintFunction<Duty> {
    public boolean evaluate(Operator operator, Object rightValue, Permission rule, PolicyContext context) {
        if (!(rightValue instanceof String)) {
            context.reportProblem("Right-value expected to be String");
            return false;
        }
        if (operator != Operator.EQ) {
            context.reportProblem("Only EQ operator is allowed");
            return false;
        }
        var participant = context.getContextData(ParticipantAgent.class);
        var location = extractLocationClaim(participant);
        return location != null && rightValue.equalsIgnoreCase(location);
    }
}
```

The `**ParticipantAgent**` is a representation of the communication counterparty containing verified claims. The evaluation function extracts relevant claims (e.g., location) and validates the policy constraint against them.

**Registration pattern** (in a `ServiceExtension`):

```java
ruleBindingRegistry.bind("headquarter_location", NEGOTIATION_SCOPE);
policyEngine.registerFunction(NEGOTIATION_SCOPE, Duty.class, "headquarter_location", new HeadquarterFunction());
```

---

#### 3.1.6 Advanced Policy Concepts

**Pre- and Post-Evaluators:** Functions executed before and after the main policy evaluation. Used for preliminary checks or to enrich the `PolicyContext` (e.g., injecting DCP scope strings via `ScopeExtractor` objects).

**Dynamic Functions:** Similar to `AtomicConstraintFunction` but also receive the `leftOperand` as a parameter. Useful when the left-operand is not known at registration time (e.g., when multiple dynamic left-operands need to be handled by a single function).

**Policy Validation (v3.1alpha API):** Beyond structural validation (missing fields), EDC provides domain-specific policy validation:

- Checks if a `leftOperand` is bound to a scope.
- Checks if a `leftOperand` is bound to an evaluation function.
- Enabled via `edc.policy.validation.enabled=true` (default: `false`).
- Called via: `POST /v3.1alpha/policydefinitions/{id}/validate`

**Policy Evaluation Plan (v3.1alpha API):** An API that shows all steps the `PolicyEngine` will take when evaluating a policy within a given scope, **without actually running the evaluation**. Useful for debugging misconfigured policy bindings.

- Called via: `POST /v3.1alpha/policydefinitions/{id}/evaluationplan` with a `policyScope` body parameter.

---

#### 3.1.7 Bundled Policy Functions

**Contract Expiration Function (`ContractExpiryCheckFunction`):** A built-in policy function bound to the `policy.monitor` scope. It evaluates whether a contract agreement has expired. This is the primary example of a policy that can automatically terminate a running transfer.

---

#### 3.1.8 Contract Definitions

A **Contract Definition** links assets to policies. It expresses under what conditions assets are offered in the dataspace.

**Components:**

- `**accessPolicyId`**: References a policy that determines whether a consumer **sees** the asset in the catalog at all. If the consumer fails the access policy, the asset is hidden entirely.
- `**contractPolicyId`**: References a policy that determines whether a consumer **can initiate a contract negotiation** for the asset. Passing this does not guarantee a successful negotiation, only that initiation is allowed.
- `**assetsSelector`**: A query expression (like a SQL `WHERE` clause) using `Criterion` objects to select which assets are included in this definition. Multiple criteria are always **ANDed together**.

**Key facts:**

- Contract definitions are **internal implementation details** — they never leave the provider and are never sent to consumers via DSP.
- They can be created **ahead of time** (no foreign-key enforcement on policy IDs).
- One contract definition can cover many assets via the `assetsSelector`.

---

#### 3.1.9 Contract Negotiations

A **Contract Negotiation** is the process by which a consumer and provider agree on the terms (policy) for accessing an asset.

**Key characteristics:**

- Targets **one asset**.
- Takes place between a **provider and a consumer connector**.
- Is **asynchronous** — it is a long-running stateful process managed by a state machine.
- Users **cannot directly change** a negotiation's state; they can only decline, terminate, or cancel.
- Contract **offers** are ephemeral (generated on-the-fly, never persisted, not queryable via API).

**States (simplified flow):** `REQUESTING` → `REQUESTED` → `OFFERED` → `ACCEPTED` → `AGREED` → `VERIFIED` → `FINALIZED` (or `TERMINATED` at any point).

**Initiating a negotiation (consumer side):** Send a `ContractRequest` to the Management API with:

- `counterPartyAddress`: DSP endpoint of the provider.
- `protocol`: `"dataspace-protocol-http"`.
- `policy`: The ODRL offer from the catalog, with `assigner` (provider's `participantId`) and `target` (asset ID).
- `callbackAddresses` (optional): Webhooks for state change notifications.

> If the consumer's policy differs from the provider's policy, the negotiation transitions to `TERMINATED`.

---

#### 3.1.10 Contract Agreements

A **Contract Agreement** is created when a contract negotiation successfully reaches the `FINALIZED` state. It is **always the provider** that gives final approval.

**Properties of a contract agreement:**

- **Immutable** after creation (analogous to a signed physical contract).
- Contains: the agreed-on policy, the asset ID, the IDs of both negotiating parties, the exact signing timestamp.
- Only exists **within the bounds of a connector** (not a cross-connector concept).

**On termination:** Contracts cannot be "un-signed". Cancellation is handled through external channels (e.g., eventing systems). The semantics of cancellation are highly use-case specific and may carry legal implications.

---

#### 3.1.11 Catalog

The **Catalog** is the set of "data offerings" that a connector exposes to potential consumers.

**Structure:**

- `**Dataset`**: Represents one data offering, containing a policy and one or more `Distribution` objects.
- `**Distribution**`: A variant or representation of a dataset. For example, a file accessible via HTTP and FTP would have two distributions. Each distribution corresponds to a specific transfer type/channel.
- `**DataService**`: Specifies the DSP endpoint where contract negotiations and transfers are accepted.

**Key behaviors:**

- Catalogs are **ephemeral** — they are generated on-the-fly per request, never cached or persisted on the provider side.
- For each request, the `DatasetResolver` evaluates all contract definitions, filters out those where the requesting participant fails the access policy, and builds the catalog.
- The resolver uses the **Dataplane Signaling Protocol (DPS)** to query available data planes and construct the list of distributions.

**Filtering the catalog:** Consumers can include a `querySpec` in their catalog request to filter datasets.

---

#### 3.1.12 Transfer Processes

A **Transfer Process** is the record of an ongoing or completed data transfer between consumer and provider.

**Flow overview:**

1. Consumer sends a `TransferRequest` to the Management API with `contractId`, `transferType`, `dataDestination`, and optional `callbackAddresses`.
2. Both sides may perform **provisioning** (e.g., deploying temporary storage). If no provisioning needed, this is a no-op.
3. Data is transmitted according to the `dataDestination`.
4. On completion: transitions to `COMPLETED`. On error: transitions to `TERMINATED`.

**Transfer Flow Types:**

**Consumer Pull:** The provider gives the consumer a `DataAddress` (containing endpoint URL and authorization token) and the consumer retrieves data directly from the provider's data plane.

- Flow: Consumer sends `TransferRequestMessage` → Provider generates `DataAddress` → Provider sends `TransferStartMessage` with `DataAddress` → Consumer uses `DataAddress` to fetch data.

**Provider Push:** The provider's data plane initiates sending data to a destination specified by the consumer.

- Flow: Consumer sends `TransferRequestMessage` with destination `DataAddress` → Provider creates `DataFlowStartMessage` with source and destination → Provider data plane streams data to destination.

**Finite vs. Non-Finite Data:**

- **Finite**: Transfer reaches `COMPLETED` when done (e.g., a single file upload).
- **Non-Finite**: Transfer stays in `STARTED` indefinitely until manually or automatically terminated (e.g., streams, API endpoints).

**Transfer process callbacks:** Recommended over polling. Register webhooks via `callbackAddresses` to receive events such as:

- `transfer.process.started`
- `transfer.process.completed`
- `transfer.process.terminated`
- `transfer.process.provisioned`, `transfer.process.deprovisioned`, etc.

**Data Destinations:** A `DataAddress` describing where the consumer expects data after the transfer. In provider-push, this is the consumer's storage endpoint. In consumer-pull, it's a placeholder. Providers must have matching data plane extensions (sources/sinks) to support the requested destination type.

---

#### 3.1.13 Endpoint Data References (EDRs)

EDRs are the mechanism for the consumer to receive and store the `DataAddress` returned during a Consumer Pull transfer. EDC provides extensions to automatically store EDRs on the consumer control plane side. Alternatively, consumers can receive them via the `transfer.process.started` event callback.

---

#### 3.1.14 Querying with QuerySpec and Criterion

Most entities can be queried using the generic `QuerySpec` object.

`**QuerySpec` properties:**

- `limit`: maximum number of results.
- `offset`: pagination offset.
- `sortField`: field name to sort by.
- `sortOrder`: `ASC` or `DESC`.
- `filterExpression`: a list of `Criterion` objects (ANDed together).

`**Criterion` properties:**

- `operandLeft`: the field/property to filter on (must use the **expanded** JSON-LD form for custom properties).
- `operator`: `=`, `!=`, `in`, `like`, `ilike`, `contains`.
- `operandRight`: the value to compare.

**Important:** Since custom properties are persisted in expanded form, queries must also use the expanded IRI form (e.g., `https://w3id.org/starwars/v0.0.1/ns/faction` not `sw:faction`).

**Store implementations:** EDC ships two implementations for every store:

- **In-memory** (default): lightweight, `Map`-based, intended for testing/demos only.
- **SQL/PostgreSQL**: production-grade, provided via optional extensions.

---

### 3.2 Policy Monitor

The **Policy Monitor** (`PolicyMonitorManager`) is a background component that watches over **ongoing (non-finite) transfers** on the provider side and periodically verifies that the associated contract policy is still valid.

**How it works:**

1. When a transfer process on the provider side transitions to `STARTED`, the eventing system notifies the Policy Monitor.
2. The Policy Monitor tracks the transfer via `PolicyMonitorEntry` entities stored in `PolicyMonitorStore`.
3. Periodically, for each monitored transfer, it retrieves the contract agreement, runs the `PolicyEngine` using the `policy.monitor` scope, and checks if the policy still holds.
4. If the policy is no longer valid, the transfer is transitioned to `TERMINATING`.
5. The data plane is also notified via the Data Plane Signaling protocol.

**Limitations for implementors:**

- The `PolicyContext` in `policy.monitor` scope does **not** contain a `ParticipantAgent` — so policies requiring Verifiable Credentials cannot be evaluated here.
- Available context data: `ContractAgreement` and the current `Instant` (timestamp).
- Custom policy functions for the monitor must be bound to the `policy.monitor` scope.

---

### 3.3 Protocol Extensions (DSP)

EDC supports inter-connector communication through **protocol extensions**. The default and official implementation follows the **Dataspace Protocol (DSP)** specification using HTTPS bindings, identified by the key `dataspace-protocol-http`.

**Core concept — `RemoteMessage`:** The central interface for all inter-connector messages. Describes the protocol, `counterPartyAddress`, and `counterPartyId`.

**Three categories of `RemoteMessage`:**

- **Catalog** (from `catalog-spi`)
- **Contract Negotiation** (from `contract-spi`)
- **Transfer Process** (from `transfer-spi`)

**Message delivery — `RemoteMessageDispatcher`:**

- Each protocol implements a `RemoteMessageDispatcher`, which is registered in the `RemoteMessageDispatcherRegistry`.
- When EDC needs to send a message, it routes to the correct dispatcher based on `RemoteMessage#getProtocol`.
- Also used for non-protocol messages like event callbacks.

**Message receiving — Protocol Services:**
On the ingress side, protocol implementations receive network messages, deserialize them into `RemoteMessage` objects, and delegate to one of three services:

- `CatalogProtocolService`
- `ContractNegotiationProtocolService`
- `TransferProcessProtocolService`

**DSP implementation structure** (under `data-protocol/dsp`):

- Separated by specification: Catalog, Contract Negotiation, Transfer Process — each in its own extension module.
- This modularity allows building runtimes that only serve a subset (e.g., catalog-only for Management Domain scenarios).
- Each specification module provides: RemoteMessage handlers, HTTP endpoints (API controllers), and JSON-LD transformers.

---

## 4. PostgreSQL Persistence

EDC uses **PostgreSQL** as its database persistence technology of choice. Every store comes with two implementations: **in-memory** (default) and **SQL/PostgreSQL** (added via extensions).

### Configuring DataSources

The `sql-pool-apache-commons` extension creates and registers pooled data sources from configuration. At minimum, a `default` data source is required:

```properties
edc.datasource.default.url=...
edc.datasource.default.name=...
edc.datasource.default.password=...
```

> **Security:** Store database credentials in a Vault. The config keys act as vault aliases. Plain-text config is unsafe.

Multiple named data sources can be defined and assigned to specific stores:

```properties
edc.sql.store.<store-context>.datasource=<datasource-name>
```

### SQL Statement Abstraction

EDC does **not** use an ORM. Instead, it uses pre-canned, parameterized SQL statements defined in interfaces extending `SqlStatements`. Two categories:

- **Literals**: Table names, column names (implemented as `default` interface methods).
- **Templates**: SQL statements like `INSERT`, `UPDATE`, `DELETE` (implemented in `BaseSqlDialectStatements`).

Statements are constructed using the `SqlExecuteStatement` utility class. Complex nested statements are discouraged; multiple simple statements within a transaction are preferred.

### Querying PostgreSQL

Queries originate from `QuerySpec` objects and are translated into SQL `SELECT` statements via `SqlQueryStatement`.

**The Canonical Form:** EDC uses a canonical form based on Java class field names (e.g., `contractAgreement.assetId`) as the universal query language. This is mapped to SQL column names via **Translation Mappings**.

**TranslationMapping:** A graph-like metamodel class (conventionally named `*Mapping`) that maps canonical field names to SQL column names.

**Mapping strategies for complex objects:**

1. **Foreign Keys (Option 1):** Referenced objects stored in separate tables. The mapping recursively descends into related mapping classes (e.g., `ContractAgreementMapping`). One-to-many with foreign keys is not yet supported.
2. **JSON Encoding (Option 2a):** Complex objects encoded as JSON and stored in a PostgreSQL `JSON` column. Queries use PostgreSQL's JSON operators (e.g., `->`, `->>`). This is PostgreSQL-specific and not portable.
3. **JSON Array Encoding (Option 2b):** Lists/arrays encoded as JSON arrays, queryable via PostgreSQL's `json_array_elements()` function.

---

## 5. The Data Plane

The **Data Plane** is the component responsible for the **actual transmission of data**. It is built on the **Data Plane Framework (DPF)** and can be extended to support different protocols and transfer types.

### 5.1 DataPlane Manager

The `DataPlaneManager` is the central coordinator of the data plane. It:

- Receives `DataFlowStartMessage` from the control plane (via DPS protocol if standalone, or direct method call if embedded).
- Manages data transmission state using the state machine pattern.
- Supports **Consumer Pull** and **Provider Push** flow types.

**Consumer Pull flow:** Delegates to `DataPlaneAuthorizationService` to generate a `DataAddress` (endpoint URL + auth token), returns it to the control plane as part of the response.

**Provider Push flow:** The data transmission itself is handled by the DPF using source and destination `DataAddress` objects from the `DataFlowStartMessage`.

### 5.2 Data Plane Framework (DPF)

The DPF provides the infrastructure for transferring data between a `sourceDataAddress` and a `destinationDataAddress`.

`**TransferService`:** The core abstraction. Given a `DataFlowStartMessage`, it can transfer data. Key methods:

- `canHandle(request)`: Whether this service can handle the request.
- `validate(request)`: Validates the message content.
- `transfer(request)`: Initiates the transfer (returns `CompletableFuture`).

Multiple `TransferService` implementations are registered in the `TransferServiceRegistry`.

`**PipelineService`:** The default `TransferService` implementation. Supports **end-to-end streaming** by connecting a `DataSource` (input) to a `DataSink` (output).

- Uses `DataSourceFactory` and `DataSinkFactory` to create source/sink pairs from a `DataFlowStartMessage`.
- Custom factories must be registered with `PipelineService` to add support for new data types.
- EDC ships with built-in support for: S3, HTTP, Kafka, Azure Storage.

```java
public interface PipelineService extends TransferService {
    void registerFactory(DataSourceFactory factory);
    void registerFactory(DataSinkFactory factory);
}
```

### 5.3 Writing Custom Source/Sink

To extend EDC with a new data type:

**1. Implement `DataSource`:** Provides a `Stream<Part>` via `openPartStream()`. Each `Part` has a name and provides an `InputStream`.

**2. Implement `DataSourceFactory`:** Declares `supportedType()` (a string matching the `DataAddress` type), validates the request, and creates the `DataSource`.

**3. Implement `DataSink`:** Receives a `DataSource` in its `transfer(DataSource)` method and writes data to the destination.

**4. Implement `DataSinkFactory`:** Declares `supportedType()` and creates the `DataSink` from the `DataFlowStartMessage`.

**5. Register both factories in a `ServiceExtension`:**

```java
pipelineService.registerFactory(new FileDataSourceFactory());
pipelineService.registerFactory(new MailDataSinkFactory(...));
```

The transfer type string (e.g., `"Mail-PUSH"`) appears in the catalog's `Distribution.dct:format`, allowing consumers to target specific transfer types in their `TransferRequest`.

---

## 6. Runtime

### 6.1 JSON-LD Serialization

**JSON-LD** (JSON for Linked Data) is a W3C standard that adds semantic context to JSON using an `@context` object. It allows data to be linked across systems using IRI-based (globally unique) identifiers.

**Key concepts:**

- `**@id`**: Uniquely identifies an object (like a primary key, but globally scoped via IRI).
- `**@context**`: Maps short term names to full IRIs. Can be inline or referenced via a URL.
- **Expanded form**: All terms replaced by their full IRIs; `@context` is no longer needed.
- **Compacted form**: IRIs shortened using namespace prefixes defined in `@context`.
- **JSON-LD Playground**: A tool for experimenting with expansion/compaction algorithms.

**How EDC uses JSON-LD:**

- EDC uses JSON-LD as the **primary serialization format at the API layer** (Management API, DSP).
- At runtime, EDC operates on objects in their **expanded form**.
- A Jersey interceptor (`JerseyJsonLdInterceptor`) automatically **expands** JSON-LD on API ingress and **compacts** it on egress.
- Extensible entity properties (like on `Asset`) are always stored in expanded form.

**Why JSON-LD in EDC?**

1. EDC uses protocols (DSP, ODRL, DCAT) that rely on JSON-LD.
2. It allows entities like `Asset` to be extended with custom properties from any namespace without schema conflicts.

`**JsonLd` SPI:** Provides `expand(JsonObject)` and `compact(JsonObject, scope)` methods. Supports scope-specific configuration of `@context` and namespace prefixes.

**Cached contexts:** Remote context documents can be cached locally to reduce network requests and limit attack surface from compromised remote hosts.

**Custom namespaces — two strategies:**

1. **Compact IRI:** Register a namespace prefix via `jsonLd.registerNamespace("sw", "http://...", "MANAGEMENT_API")`. The IRI is shortened to `sw:term` in egress.
2. **Custom Remote Context:** Register a context URL (e.g., `http://w3id.org/starwars/context.jsonld`) with term definitions. Terms appear without any prefix in output. Cache the context locally for reliability.

**JSON-LD Validation:** The `JsonObjectValidatorRegistry` accepts `Validator<JsonObject>` implementations registered per `@type`. The built-in `JsonObjectValidator` provides a declarative builder API for common validation rules (mandatory ID, mandatory fields, nested object validation, type checks).

---

### 6.2 Programming Primitives

#### State Machines

EDC is **asynchronous by design**. Long-running processes (contract negotiations, transfers) traverse a series of states managed by a state machine. State is always persisted, enabling:

- Arbitrary start/stop of connector runtimes.
- Horizontal scaling (multiple replicas pick up from where others left off).

**Implementation:**

- `StateMachineManager` uses a set of `Processor` objects.
- Each `Processor` handles `StatefulEntity` objects in a specific state.
- Processors are invoked **sequentially** in each iteration.
- If nothing was processed, the state machine sleeps for a configurable tick-over timeout.

**Safeguards:**

- **Batch size**: Maximum entities per state fetched per iteration.
- **Sorting**: Entities sorted by `stateTimestamp` (oldest first) to prevent starvation.
- **Database-level locking (Lease)**: In clustered deployments, EDC uses pessimistic exclusive locks (`Lease` table entries) to prevent two replicas from processing the same entity concurrently.

> **Note on clustering:** The `edc.runtime.id` property is used to identify the lease holder. Use randomized runtime IDs (the default) in clustered environments.

#### Transformers

EDC's custom SerDes (serialization/deserialization) layer, necessary because JSON-LD's extensibility is incompatible with Jackson's rigid schema approach.

- **Base class:** `AbstractJsonLdTransformer<I, O>`
- **Naming convention:** `JsonObject[To|From]<Entity>Transformer` (e.g., `JsonObjectToAssetTransformer`).
- Transformers come in **pairs** (one for each direction).
- **Transformer context:** Complex nested objects are delegated back to the `TransformerContext`, which holds the global `TypeTransformerRegistry`. Transformers only deserialize first-order properties.
- **Registration:** Every module with transformers registers them in `TypeTransformerRegistry` via its extension's `initialize()` method.
- **Segmented registries:** When the same entity needs different serialization formats for different APIs (e.g., `DataAddress` on Signaling API vs. DSP API), segmented registries identified by a context string (e.g., `"signaling-api"`) solve the conflict.
- **Error reporting:** Transformation errors are reported to `TransformerContext` (not thrown as exceptions). Basic JSON validation is done by validators, not transformers.

#### Token Generation and Decorators

EDC generates tokens (typically JWTs) via `TokenGenerationService`. **Token Decorators** are functions that contribute claims and headers:

```java
TokenDecorator jtiDecorator = params -> params.claim("jti", UUID.randomUuid().toString());
var token = tokenGenerationService.generate("my-private-key-id", jtiDecorator);
```

`TokenGenerationService` is intentionally not injectable (client code should be opinionated about token technology).

#### Token Validation and Rules

Incoming tokens are validated by `TokenValidationService`. Every JWT must carry a `kid` header (key ID). A `PublicKeyResolver` downloads the public key for verification.

**Validation steps:**

1. Cryptographic signature verification (using resolved public key).
2. Claims validation via registered `TokenValidationRules`.

**Validation contexts** (for `TokenValidationRulesRegistry`):


| Context Key      | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `dcp-si`         | Self-Issued ID tokens in the Decentralized Claims Protocol (DCP). |
| `dcp-vc`         | Verifiable Credentials with external JWT proofs (JWT-VCs).        |
| `dcp-vp`         | Verifiable Presentations with external JWT proofs (JWT-VPs).      |
| `oauth2`         | OAuth2 token validation.                                          |
| `management-api` | External tokens in Management API ingress (delegated auth).       |


Custom rules can be added per context via `TokenValidationRulesRegistry.addRule(context, rule)`.

**Public Key Resolvers:** Services that resolve public keys from JWKS URLs or DID documents. Multiple strategies can be combined in a dispatcher pattern. For resolving own public keys, a local resolver avoids unnecessary remote calls.

---

### 6.3 Extension Model

The **extension model** is EDC's plugin system. Any Java module placed on the classpath can enrich or influence the runtime behavior of EDC.

**Three requirements to register an extension:**

1. A class implementing `ServiceExtension`.
2. A provider-configuration file (as required by `java.util.ServiceLoader`).
3. The module added to the runtime's Gradle build file as `runtimeOnly(project(...))`.

**Extensions should NOT contain business logic.** Their job is to:

- Read and handle configuration.
- Instantiate and register services with the service context.
- Allocate and free resources (e.g., scheduled tasks).

**Autodoc:** EDC can generate JSON documentation of its extensions using `./gradlew autodoc`, producing `build/edc.json`. The `@Provider`, `@Inject`, `@Provides`, and `@Requires` annotations power this.

**