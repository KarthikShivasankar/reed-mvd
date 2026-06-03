Here is the complete deep `wiki.md` assembled from every page of the Eclipse EDC Adopters Manual:

---

```markdown
# Eclipse Dataspace Components (EDC) — Adopters Manual Wiki

> **Source:** https://eclipse-edc.github.io/documentation/for-adopters/  
> **Last modified:** May 27, 2026  
> **Purpose:** Comprehensive reference document for LLM consumption — covers every section of the EDC Adopters Manual.

---

## Table of Contents

1. [Overview & Getting Started](#1-overview--getting-started)
2. [Dataspaces](#2-dataspaces)
3. [Modules, Runtimes, and Components](#3-modules-runtimes-and-components)
4. [Control Plane](#4-control-plane)
5. [Data Plane](#5-data-plane)
6. [Identity Hub](#6-identity-hub)
7. [Issuer Service](#7-issuer-service)
8. [Federated Catalog](#8-federated-catalog)
9. [Distributions, Deployment, and Operations](#9-distributions-deployment-and-operations)
10. [Tuning](#10-tuning)
11. [Extensions](#11-extensions)
12. [Testing](#12-testing)

---

## 1. Overview & Getting Started

### The Samples
The quickest way to get started building with EDC is to work through the **samples**. They cover everything from basic file-sharing scenarios to advanced streaming and large-data use cases.

### The MVD (Minimal Viable Dataspace)
The **EDC Minimal Viable Dataspace (MVD)** sets up and runs a complete demonstration dataspace between two organizations, including automated setup of a complete dataspace environment in a few minutes.

### Overview: Key Components

EDC is architected as **modules called extensions** that can be combined and customized to create **components** (the "C" in EDC). Components are not microservices in the conventional sense — they may be deployed as separate services or collocated in a runtime process.

#### The Connector
The Connector is a **pair of components** that control data sharing and execute data transfer:
- **Control Plane** — manages contract agreements, data transfers, and policy compliance.
- **Data Plane** — executes data transfers at the direction of the Control Plane.

Components may be deployed as a monolith or as clustered individual services. Separating Control Plane and Data Plane is recommended for independent management and scaling.

#### The Control Plane
- Creates contract agreements granting access to data.
- Manages data transfers (finite and non-finite/streaming).
- Monitors usage policy compliance.
- A consumer's Control Plane initiates **asynchronous** contract negotiations with a provider's connector.
- Can pause, resume, or terminate transfers in response to conditions (e.g., contract expiry).

#### The Data Plane
- Executes data transfers using specialized wire protocols (messaging systems, data integration platforms, etc.).
- EDC includes the **Data Plane Framework (DPF)** for building custom Data Planes.
- Custom Data Planes can also be built in any language by implementing the **Data Plane Signaling API**.

#### Federated Catalog
Crawls and caches data catalogs from other dataspace participants, building a local cache queryable without requiring complex distributed queries.

#### Identity Hub
Securely stores and manages W3C Verifiable Credentials, including VC presentation, issuance, and re-issuance.

### The Big Picture: The Dataspace Context

A **dataspace** is a context between two or more participants sharing data — there is no "dataspace software" as such. Key interactions:
- **Federated Catalog** fetches data catalogs from other participants.
- **Connector** negotiates contract agreements and manages transfers.
- **Identity Hub** presents verifiable credentials to establish trust.

EDC components can be deployed in a single runtime or distributed topology (multiple ReplicaSets or clusters). Advanced topologies support **Management Domains** where departments manage specific EDC instances.

### Customizing the EDC

EDC follows a "one size does not fit all" philosophy. Before deploying, you need to build customizations:
- **Policies** — code-first approach; write policy functions for data access and usage control.
- **Verifiable Credentials** — define W3C VC types for your use cases.
- **Data transfer types** — choose built-in (HTTP, S3, Kafka) or implement a custom data plane.
- **Backend connectivity** — integrate with back-office systems via custom extensions.

Third-party extensions are typically hosted on Maven Central.

---

## 2. Dataspaces

### Definition
A **dataspace** is a context between one or more participants that share data. A participant is typically an organization but can be any entity (service, machine, etc.).

### Dataspace Protocol (DSP): The Lingua Franca for Data Sharing

The **Dataspace Protocol Specification (DSP)** defines the messages exchanged in a dataspace. EDC implements DSP's asynchronous messaging patterns. DSP covers:
- Retrieving data catalogs.
- Conducting negotiations to create contract agreements.
- Sending data over various lower-level wire protocols.

DSP does **not** specify how "trust" is established between participants. Trust is handled by the **Decentralized Claims Protocol (DCP)**, which layers on top of DSP.

### The Question of Identity

A participant has a **single identity**, which is a URI. EDC supports multiple identity systems:
- **OAuth2**
- **Decentralized Claims Protocol (DCP)** — identity is a **Web DID** in this case.

An EDC component (e.g., control plane) acts as a **participant agent** — a system running on behalf of a participant, using that participant's single identity.

#### Simple Scenarios

**Single Deployment:** An organization deploys a single-instance control plane with exactly one identity. Even with multiple instances in a Kubernetes ReplicaSet, all instances share the same identity.

**Distributed Deployment (Management Domains):** Different departments manage EDC components independently in separate management domains, potentially across different Kubernetes clusters and cloud environments. Externally, the organization appears unified (single top-level catalog, multiple sub-catalogs). All control plane instances across all domains use the same identity.

**Multiple Operating Units:** A multinational with autonomous subdivisions in different geographic regions can assign each subdivision a distinct dataspace identity. Each operating unit's EDC components are configured with different identities.

### Common Misconceptions

**"Data transfers are only about static files"** — EDC supports open-ended transfers: streaming, API access, event streams, API endpoints. Access can be paused or terminated based on data use policy evaluation.

**"Dataspace software has to be installed"** — There is no dataspace "application." A dataspace is a decentralized context; participants deploy EDC and communicate via DSP and DCP.

**"EDC adds a lot of overhead"** — EDC is a lightweight engine. It adds no overhead to data transmission since specialized wire protocols handle that. For example, once a consumer obtains access to an API endpoint, requests go directly to the provider without being proxied through EDC.

**"Cross-dataspace communication"** — All data sharing takes place *within* a dataspace. A participant can share data across dataspaces only if it (or the counterparty) is a member of both dataspaces. Interoperability between dataspaces requires: compatible identity systems, common verifiable credentials/issuers, and agreed data sharing policies.

---

## 3. Modules, Runtimes, and Components

### Module System Overview
EDC is built on a **module system** that contributes features as extensions to a runtime. Runtimes are assembled into **components** (control plane, data plane, identity hub, etc.). A component may consist of a single runtime or a cluster of runtimes.

The module system provides:
- Easy addition of customizations.
- Support for diverse deployment topologies (single-instance to highly reliable multi-cluster).

### Three Identifier Types

| Identifier | Scope | Persistence |
|---|---|---|
| **Participant ID** | Organization's identifier in the dataspace (often a Web DID). All runtimes of all components of that organization share this ID. | Permanent |
| **Component ID** | Specific component (e.g., a control plane deployment). All runtimes within one component share the same Component ID. | Permanent (survives restarts) |
| **Runtime ID** | Unique to each runtime instance. Used for cluster locks and tracing. | Ephemeral (does not survive restarts) |

If an organization deploys two data planes across separate clusters, they will have two distinct **component IDs** but the same **participant ID**.

---

## 4. Control Plane

### Overview
The control plane is responsible for:
- Assembling catalogs.
- Creating contract agreements granting access to data.
- Managing data transfers.
- Monitoring usage policy compliance.

Control plane operations are performed via the **Management API**. Consumer and provider control planes communicate using **DSP**. The consumer control plane requests catalogs, uses contract agreements as tokens for data access (encoded as ODRL, bound to the consumer's Participant ID), and initiates data transfers. Every control plane must be configured with a **Participant ID**.

A data transfer controls the flow of data but does **not** send it — that is done by the data planes via a separate wire protocol. A control plane may use multiple data planes, communicating via the **Data Plane Signaling API** (RESTful).

### Management API

A RESTful interface for client applications to interact with the control plane. Never expose over the Internet or non-trusted networks. It can be secured via an authentication key or third-party OAuth2 identity provider. OpenAPI documentation: `https://eclipse-edc.github.io/Connector/openapi/management-api/`

### Catalogs, Datasets, and Offers

A data provider uses its control plane to publish a **DCAT Catalog**. Catalog requests are made using DSP (HTTP POST).

**Example catalog response:**
```json
{
  "@context": {...},
  "dspace:participantId": "did:web:example.com",
  "@id": "567bf428-81d0-442b-bdc8-437ed46592c9",
  "@type": "dcat:Catalog",
  "dcat:dataset": [{
    "@id": "asset-1",
    "@type": "dcat:Dataset",
    "description": "...",
    "odrl:hasPolicy": {...},
    "dcat:distribution": [{...}]
  }]
}
```

- **Datasets** represent data the provider wishes to share. Each has an `odrl:hasPolicy` (ODRL usage policy) and one or more `dcat:distribution` entries.
- Catalogs are serialized as **JSON-LD** (EDC makes heavy use of this).
- Catalogs are **dynamically generated** per consumer based on identity and credentials — not static documents.
- A `dcat:distribution` describes the wire protocol (e.g., `HttpData-PULL`, `S3-PUSH`) and references a `dcat:accessService` for negotiating access.

**Why JSON-LD instead of plain JSON?** DSP is based on DCAT and ODRL which rely on JSON-LD. JSON-LD also provides a namespace-like feature to avoid property name clashes for custom attributes.

### EDC Entities

#### Assets
An **Asset** is the primary building block for data sharing. It is a *descriptor* — not the actual data — and can represent:
- A file or group of files.
- A continual data stream.
- An API endpoint.
- A set of computations.

Assets are loaded into EDC via the Management API.

**Example asset:**
```json
{
  "@context": { "edc": "https://w3id.org/edc/v0.0.1/ns/" },
  "@id": "899d1ad0-532a-47e8-2245-1aa3b2a4eac6",
  "properties": { "somePublicProp": "a very interesting value" },
  "privateProperties": { "secretKey": "..." },
  "dataAddress": { "type": "HttpData", "baseUrl": "http://localhost:8080/test" }
}
```

- `properties` — visible to clients; included in DSP messages.
- `privateProperties` — not visible to clients; for internal tagging/categorization.
- `dataAddress` — pointer to where actual data resides (`HttpDataAddress`, `S3DataAddress`, messaging topic, etc.). Do **not** store secrets here; use a secure store instead and include a reference.
- Assets **must** have a globally unique ID (recommended: JDK UUID).

#### Understanding Expanded Assets
Assets use JSON-LD contexts (`@context`) to enable namespaces for custom properties. EDC persists assets in **expanded form** (full term URIs inlined). When defining custom properties, always include the custom context to avoid being expanded under the EDC default context (`https://w3id.org/edc/v0.0.1/ns/`). Queries for assets must reference property names in their expanded form.

#### Policies and Policy Definitions
Policies define duties, rights, or obligations using **ODRL**. EDC uses policies for:
- Dataset offers in catalogs (access requirements).
- Contract agreements (granting data access).
- Access control.

Policies are loaded via the Management API as **policy definitions** containing an ODRL policy. The policy definition's `@id` is referenced in contract definitions, enabling policy reuse.

**Example policy definition:**
```json
{
  "@context": { "edc": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "PolicyDefinition",
  "policy": {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@id": "8c2ff88a-74bf-41dd-9b35-9587a3b95adf",
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

#### Contract Definitions
**Contract definitions** link assets and policies. They contain:
- **Contract Policy** — what requirements a consumer must fulfill and what rights it has. Corresponds directly to a dataset offer (visible to consumers in catalog).
- **Access Policy** — determines whether a consumer can access an asset at all (hidden from consumers; evaluated only by the provider's runtime).
- **assetsSelector** — a query (like a SQL SELECT) that returns which assets the definition applies to.

**Example contract definition:**
```json
{
  "@context": { "edc": "https://w3id.org/edc/v0.0.1/ns/" },
  "@type": "https://w3id.org/edc/v0.0.1/ns/ContractDefinition",
  "@id": "test-id",
  "edc:accessPolicyId": "access-policy-1234",
  "edc:contractPolicyId": "contract-policy-5678",
  "edc:assetsSelector": [
    {
      "@type": "https://w3id.org/edc/v0.0.1/ns/Criterion",
      "edc:operandLeft": "id",
      "edc:operator": "in",
      "edc:operandRight": ["id1", "id2", "id3"]
    },
    {
      "@type": "https://w3id.org/edc/v0.0.1/ns/Criterion",
      "edc:operandLeft": "productCategory",
      "edc:operator": "=",
      "edc:operandRight": "gold"
    }
  ]
}
```

`assetsSelectors` are **late-bound** and evaluated at runtime, allowing contract definitions to be created before assets exist — enabling security-first design.

### Catalog Generation

When a consumer requests a catalog, the provider dynamically generates it:
1. Control plane retrieves contract definitions and evaluates **access and contract policies** against the consumer's claims (from verifiable credentials and custom extension data).
2. `assetsSelector` queries from passing contract definitions return a list of assets.
3. Assets are iterated; each is combined with the contract policy to create a **dataset**.
4. Datasets are collected into a catalog and returned.

One asset may produce **multiple datasets** if selected by more than one contract definition.

**Performance Design Principle:** Avoid 1:1 contract definition-to-asset relationships. Use contract definitions to select *groups* of assets; add custom asset properties as selection labels. This minimizes the number of contract definitions evaluated on every catalog request.

### Contract Negotiations

After receiving a catalog, a consumer requests a dataset by sending a **DSP contract negotiation request** via the Management API. The negotiation is asynchronous and progresses through states defined by DSP. Both consumer and provider can transition the negotiation by sending DSP messages.

When finalized, a **DSP contract agreement message** is sent to the consumer, containing a contract agreement (ODRL-encoded, bound to the consumer's Participant ID) usable to initiate a transfer process.

**Reliable Messaging:** All message operations and state machine transitions are performed transactionally. EDC only commits a transition after the counterparty acknowledges. Failed sends are retried. Operations are idempotent.

**Asynchronous Design:** Do not wrap EDC's async messaging in synchronous APIs — this breaks reliability guarantees. Instead, use EDC's **EventRouter** to subscribe to events (e.g., contract negotiation finalized) and react accordingly. Two dispatch modes: **asynchronous** (fire-and-forget) or **synchronous transactional** (reliably deliver to external systems like message queues or databases).

**Reliable Messaging Details:**
- All messages have unique IDs and are idempotent.
- Reliable across restarts — another cluster instance or the restarted runtime sends pending messages.
- Achieved via state machines persisted transactionally to Postgres.

### Transfer Processes

After contract negotiation finalization, a consumer initiates a **Transfer Process** via the Management API.

- **Finite transfer** — completes after data (e.g., a file) is transferred.
- **Non-finite transfer** — ongoing (data stream, API access); continues until explicitly terminated.

**Asset Modeling Best Practice:**
- Don't model each granular item (e.g., each part in a parts catalog) as a separate asset — this creates massive overhead.
- Use a single asset for aggregate data (all parts, or a significant subset).
- Keep one Contract Negotiation per relationship; use a non-finite Transfer Process kept open so consumers can make multiple requests over time.

### Flow Types

#### Consumer Pull
The consumer initiates the data flow. Common example: HTTP request to an endpoint.
- The provider sends an **EDR (Endpoint Data Reference)** containing the coordinates and access token to reach the provider's public endpoint.
- The consumer then fetches data directly.

#### Provider Push
The provider actively pushes data to the consumer's destination.
- The consumer sends an access token when initiating the Transfer Process.
- The consumer's data plane prepares the destination endpoint (e.g., object storage).
- The provider uses the token to push data once ready.

### Transfer Process States

| State | Description |
|---|---|
| `REQUESTED` | Consumer has requested data transfer from the provider. |
| `STARTED` | Consumer received start message from provider. Data is available for pull or being pushed. |
| `SUSPENDED` | Suspend message received; all in-process data send operations paused. |
| `RESUMED` | Resume message received; operations restarted. |
| `COMPLETED` | Data transfer completed. |
| `TERMINATED` | Termination message received; all in-process operations stopped. |

Internal states (no counterparty notification):

| State | Description |
|---|---|
| `PROVISIONED` | Pre-transfer setup performed by consumer (before REQUESTED) or provider (after receiving request). |
| `DEPROVISIONED` | Post-transfer cleanup by provider. |

Custom code can react to state transitions via the **EventRouter**. A **Provisioner extension** or **HttpProviderProvisioner** can execute tasks during provisioning.

### Policy Monitor

For non-finite transfers, the **PolicyMonitor** periodically checks consumer credentials (e.g., verifying ongoing partner status or industry certification). It can be embedded in the control plane or run as a standalone runtime.

---

## 5. Data Plane

### Overview
A data plane transmits data using a wire protocol at the direction of the control plane. Data planes range from simple serverless functions to data streaming platforms or APIs. One control plane may manage multiple specialized data planes.

### Separation of Concerns
Although a data plane can be collocated with a control plane, this is **not recommended**. The data plane should typically be a separate set of instances in an independent environment (e.g., separate Kubernetes cluster) for independent operation and scaling.

At runtime, a data plane **registers** with a control plane. The control plane then directs it via the **Data Plane Signaling API**.

EDC does **not** ship an out-of-the-box data plane. It provides the **Data Plane Framework (DPF)** for building custom data planes (or you can build your own in any language implementing the registration protocol and Signaling API).

### Data Plane Registration

- Registration is performed at startup by the data plane using its component ID.
- Registration is **idempotent and persistent** — available to all clustered control plane runtimes via persistent storage.
- After registration, the control plane periodically sends a **heartbeat** and culls the registration if the data plane is unavailable.

Registration metadata includes:
- Supported wire protocols and transfer types (e.g., "HTTP-based consumer pull", "S3-based provider push").
- Supported data source types.

The control plane uses this metadata to:
1. Determine which transfer types are available for an asset (for catalog generation).
2. Select the appropriate data plane when a transfer process is requested.

### Data Plane Signaling

The control plane communicates with data planes via the **Data Plane Signaling API** (RESTful).

Signaling flow:
1. When a transfer process starts and a data plane is selected, a **start message** is sent.
2. For **consumer-pull** transfers, the response contains an **EDR (Endpoint Data Reference)** — coordinates to the data and an access token.
3. The control plane may send additional signals: `SUSPEND`, `RESUME`, `TERMINATE` (e.g., on policy violation from the policy monitor).

### The Data Plane Framework (DPF)

EDC includes the **DPF** for building custom data planes:
- Supports **end-to-end streaming transfers** (data is streamed, not materialized in memory).
- Supports both **pull** and **push** style transfers.
- Extensible for different data sources and sinks (S3, HTTP, Kafka, etc.).
- Can perform **direct streaming** between different source and sink types.
- Examples in the EDC Samples repository.

---

## 6. Identity Hub

### Overview
**Identity Hub (IH)** manages organization identity resources (credentials) for dataspace participants. It is designed for **machine-to-machine interactions** — it does not manage personal verifiable credentials.

Identity Hub implements the **Decentralized Claims Protocol (DCP)** and is based on:
- W3C DIDs
- W3C `did:web` Method
- W3C Verifiable Credentials Data Model v1.1

**Does Identity Hub support OID4VC?** No. OID4VC mandates human (end-user) interactions. Identity Hub implements DCP, which is designed for non-human flows.

Identity Hub manages:
- **Verifiable Credentials** — receiving, managing issued credentials, generating Verifiable Presentations (VPs).
- **Key Pairs** — generating, rotating, revoking signing keys.
- **DID Documents** — generating and publishing DID documents.

The **EDC MVD Project** provides a full test dataspace setup with Identity Hub.

### Identities and Credentials in a Dataspace: The Role of Identity Hub

#### Centralized vs. Decentralized Identity

Traditional OAuth2 uses a **centralized model** — a central Identity Provider issues and signs tokens. Problems with this for dataspaces:
- **Single point of failure** — if the IdP goes down, the dataspace is inoperable.
- **Privacy violation** — the IdP is privy to communications between consumers and providers.
- **Loss of control** — the IdP manages credentials, not the actual dataspace participants.

**DCP and Identity Hub** address this with **decentralized identity**: no single point of failure, privacy maintained, participants control their own identities and credentials.

### The Presentation Flow

When a consumer's control plane makes a contract negotiation request to a provider requiring VC proof:
1. Instead of a token from a third-party IdP, DCP mandates **self-issued tokens**.
2. The JWT `sub` claim contains the sender's **Web DID**. The JWT is signed with a key from the associated DID document.
3. The provider verifies identity by resolving the DID document and checking the JWT signature.
4. The JWT also contains an **access token** in the `token` claim. The provider uses this to query the consumer's Identity Hub for a **Verifiable Presentation** containing required credentials.
5. The provider finds the IH endpoint via a `CredentialService` service entry in the resolved DID document.
6. Once the VP is obtained, the provider verifies the VC to establish trust.

**Why not include the VP in the HTTP header?** VPs often exceed HTTP header size limits. Additionally, the DCP model enables the policy monitor to query the consumer's IH for credentials periodically (without a consumer-initiated flow) — essential for ongoing stream policy checks.

### Verifiable Presentation Generation

When a provider issues a presentation request, IH generates a VP. Two query mechanisms:
- **Scope strings** (currently supported) — string-based scope mapped to VC types.
- **DIF Presentation Exchange** (in development).

Default scope mapping translates a scope string to a VC type. This can be overridden by implementing `ScopeToCriterionTransformer`.

Two VP formats:
- **JWT-based** (default, recommended — ~10x better performance than Linked-Data Proof).
- **Linked-Data Proof**.

### Issuance Flow

DCP defines an **asynchronous** issuance process:
1. Identity Hub sends a request to the issuer endpoint including a self-signed identity token.
2. The token contains an access token the issuer uses to send the VC to the requester's IH.
3. The VC is issued immediately or after an approval process.
4. Issuers can also require VC proof from the requester (e.g., a dataspace membership credential) before issuing.

**Note:** Identity Hub issuance support is currently a work in progress.

### Deployment Topologies

#### Organizational Component
Deployed as a centrally managed component. All connectors across all dataspaces the organization participates in use the central Identity Hub for credentials.

#### Per Dataspace Component
Each regional dataspace gets its own Identity Hub instance. Supports geographic isolation and separate management.

#### Embedded
Identity Hub embedded in the same runtime process as other connector components. Optimized for edge-style deployments where footprint and latency matter.

### Identity Hub APIs

- **Identity API** — for managing resources (CRUD). Requires elevated admin privileges. Never expose over public networks.
- **DCP API** — implements the DCP wire protocol. End-users generally do not interact directly with this API.

### The Participant Context

A **participant context** is a unit of control for resources in Identity Hub, tied to a dataspace participant identity. Usually, one context per organization identity.

States:
- `CREATED` — initialized but not operational. Resources can be added/updated but are not publicly accessible.
- `ACTIVATED` — operational; resources publicly accessible.
- `DEACTIVATED` — not operational; resources can be added/updated but not publicly accessible.

Transitions: `CREATED` → `ACTIVATED` ↔ `DEACTIVATED`.

The participant context acts as both a **scope** and **security boundary**. JWT access tokens are scoped to a specific context. If a context is deleted, all contained resources cascade-delete.

Identity Hub uses EDC's eventing system so services can register for participant context events (create, delete) to implement custom workflows.

### DID Documents

When a participant context is **created**, it is associated with a DID. When **activated**, the corresponding DID document is generated and published (Web DID URL). Identity Hub currently only supports **Web DIDs** (other DID methods can be added via custom extensions implementing `DidDocumentPublisher`).

IH includes an extension for locally publishing Web DID documents via a public API under the `/did` path. For high-volume scenarios, publishing to a dedicated web server is recommended.

### Key Pair Resources

Used to sign and verify credentials, presentations, and other resources. Public/private keys can be generated by IH or provided at creation. Private keys are persisted in a secure store (**Hashicorp Vault** supported).

States: `CREATED` → `ACTIVATED` → `ROTATED` or `REVOKED`

#### Key Activation
When activated, IH makes the public key available as a verification method in the DID document (by publishing an updated DID document).

#### Key Rotation
Staged rotation to avoid service disruptions:
- New key pair B-B' is created and used going forward.
- Old private key A is immediately destroyed.
- Old public key A' remains in the DID document until all resources signed by A expire.

**Best practice:** Signed resources should have a validity period less than the key rotation period and should be reissued frequently.

#### Key Revocation
If a private key is compromised, it must be immediately revoked: the verification method is removed from the DID document and the updated document is published. This invalidates all resources signed with that key pair.

#### Using Vault's Transit Engine for Signing
Identity Hub can delegate signing operations to **Vault's Transit Engine**. In this mode, IH never accesses the private key material — it sends data and a key reference to Vault, which performs the signing and returns the signature. This eliminates the risk of private key exposure in application memory.

### Verifiable Credentials
Storage via the DCP issuance flow is currently in development. In the meantime, adopters must develop custom extensions or use the Identity API.

### Resource Operations and Transactional Guarantees

#### Participant Context Operations

**Create:**
1. Open transaction.
2. Generate API key.
3. Create DID document in storage.
4. Create default key pair in storage.
5. Publish DID document if context is set to active.
6. Commit or rollback.

**Delete:**
1. Open transaction.
2. Unpublish DID document if PUBLISHED.
3. Remove DID document from storage.
4. Remove all associated key pairs (except private keys).
5. Remove participant context.
6. Commit or rollback.
7. After commit: remove all private keys (Vaults are not transactional; manual intervention needed if this fails, but IH remains consistent).

**Activate:** Requires a default key pair. Updates context, publishes DID document. Transactional.

**Deactivate:** Updates context, unpublishes DID document. Transactional. Force option available if unpublish fails.

#### Key Pair Operations

**Activate:**
1. Transaction: add key pair to storage, publish updated DID document with new verification method.
2. If commit fails, DID document must be manually repaired (republish).

**Rotate:**
1. Transaction: add new key pair to storage, publish updated DID document with new verification method.
2. After commit: destroy old private key (not public key).

**Revoke:**
1. Transaction: update key pair state, publish updated DID document with revoked verification method removed.

---

## 7. Issuer Service

### Overview
The **IssuerService (IS)** is an EDC component responsible for **issuing Verifiable Credentials** to entities within a data ecosystem using DCP. It shares many properties with Identity Hub.

Holders request credentials via the **Issuance API**. The IssuerService asynchronously processes the request and delivers the VC to the holder's **Storage API** (a DCP-compliant endpoint in the holder's Identity Hub).

### Basic Concepts

Holders must operate a DCP-compliant Storage API. They expose their Storage API endpoint via a `CredentialService` entry in their DID document:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:example:holder123",
  "service": [{
    "id": "did:example:holder123#credential-storage",
    "type": "CredentialService",
    "serviceEndpoint": "https://holder.example.com/credentials"
  }]
}
```

**Key points:**
- Issuance is **asynchronous** — credential requests can involve manual approval steps.
- IssuerService tracks all issued credentials (unsigned claim data + metadata) but **never stores the signed credential itself**.
- Issuers can send a **Credential Offer** message to inform holders that a new or updated credential is ready for pickup (e.g., after key rotation).

### Configuring the IssuerService

IssuerService requires a **CredentialDefinition** describing the shape of the credential (mapping input variables to output fields in the `credentialSubject`):

```json
{
  "attestations": ["db-attestation-def-1"],
  "credentialType": "MembershipCredential",
  "id": "demo-credential-def-2",
  "jsonSchema": "{}",
  "jsonSchemaUrl": "https://example.com/schema/demo-credential.json",
  "mappings": [
    { "input": "membership_type", "output": "credentialSubject.membershipType", "required": "true" },
    { "input": "membership_start_date", "output": "credentialSubject.membershipStartDate", "required": true }
  ],
  "rules": [],
  "format": "VC1_0_JWT"
}
```

### Preconfigured vs. Anonymous Credential Requests

**Preconfigured (pre-registered holders):** Holders undergo onboarding/vetting; a `Holder` entity is created in IssuerService's database before credential requests are allowed. Enables linking additional data to the holder for inclusion in the VC.

**Anonymous credential requests:** Enabled via `edc.issuance.anonymous.allowed=true` (default: disabled). Holder is created on-the-fly from the DID in the self-issued ID token. The `Holder` entity has `anonymous: true`. All `AttestationSource` implementations must handle both types by inspecting the `anonymous` flag.

### Generating Verifiable Credentials

**Synchronous steps (on receiving a CredentialRequest):**
1. Validate the holder's self-issued ID token (signature, expiration, audience).
2. Look up or create (anonymous) or reject the Holder entity.
3. Look up the CredentialDefinition.
4. Construct and execute each `AttestationSource` to gather claims data.
5. Evaluate all rules in the CredentialDefinition.
6. Return HTTP success acknowledging receipt; request becomes an **IssuanceProcess**.

**Asynchronous steps:**
1. Generate VC JSON document from claim mappings.
2. Sign the VC using the Issuer's private key (default: JWT; extensible via custom `CredentialGenerator`).
3. Record VC in the status list credential.
4. Deliver signed VC to the holder's Storage API.

### Credential Revocation

Each VC may contain a `credentialStatus` field referencing a **status list credential** — a VC with an encoded bitstring indicating revoked/suspended credentials. When new credentials are issued, IssuerService adds them to its status list and records the corresponding index in the `credentialStatus` field.

Supported types: **BitStringStatusList** (default, newer spec) and **StatusList2021** (legacy).

### Extensibility of the IssuerService

Extensible areas:
- **Credential generators** — custom `CredentialGenerator` for formats like Linked Data Proofs, SD-JWT, COSE.
- **Status list credential types** — custom `StatusListManager` implementations.
- **Persistence stores** — custom `*Store` interface implementations (PostgreSQL and in-memory supported out-of-the-box).
- **Attestation sources and factories** — out-of-the-box options:
  - `DatabaseAttestationSource` — fetches columns from SQL DB linked to holder ID.
  - `PresentationAttestationSource` — extracts claims from VPs provided by the holder (still in development).

### IssuerService APIs

#### Issuance API (DCP-compliant)
- **Credential Request API** — holders initiate issuance.
- **Issuer Metadata API** — exposes supported credential types/formats.
- **Credential Request Status API** — holders query request status.

All endpoints prefixed with base64-encoded participant context ID: `v1alpha/participants/{base64(participantContextId)}/credentials`.

#### Administration API
- **Attestation API** — CRUD for `AttestationDefinition` objects.
- **Credentials API** — revoke/suspend/resume credentials, trigger credential offers.
- **Holder API** — manage `Holder` entities.
- **CredentialDefinition API** — manage `CredentialDefinition` objects.
- **IssuanceProcess API** — query `IssuanceProcess` objects.

Full OpenAPI spec available.

### Deployment Options

| Runtimes | Participant Context IDs | Database + HSM/Vault | Supported |
|---|---|---|---|
| Co-located | Same | Shared | ✅ |
| Co-located | Different | Both | ✅ |
| Separate | Same | Separate | ✅ |
| Separate | Different | Both | ✅ |
| Separate | Same | Different | ⚠️ (requires custom DidPublisher) |

**Strong recommendation:** Deploy IssuerService as a **standalone runtime** with its own HSM (Vault) and database in a specially protected environment with strict access controls and potential network isolation. Private keys to sign credentials are extremely sensitive.

When IssuerService and IdentityHub use the same participant context ID, the `ParticipantContext` object must only be created once. If they are separate runtimes with the same context ID but different databases, a custom `DidPublisher` is required to prevent DID documents from being overwritten.

---

## 8. Federated Catalog

### Overview
The **Federated Catalog (FC)** provides scalable metadata discovery in decentralized dataspaces. It employs **crawlers** that periodically scrape catalogs from each participant (from a participant list) and consolidates them in a local cache — a unified, searchable view of available data assets across the network.

**Benefits:**
- Faster and more reliable catalog queries (no real-time access to all participants needed).
- Reduced network load.
- Read-optimized replica of participant catalogs.

The FC is based on EDC components for core functionality (extension loading, runtime bootstrap, configuration, API handling) with FC-specific functionality added via EDC's extensibility mechanism.

### Main Components

| Component | Description |
|---|---|
| **Federated Catalog Cache (FCC)** | Crawls participant connectors and maintains the aggregated catalog cache. |
| **Federated Catalog Node (FCN)** | Hosts a participant's catalog and responds to catalog requests from external crawlers. |

| Feature | FCN | FCC |
|---|---|---|
| Serves catalog to participants | ✅ | — |
| Caches foreign catalog entries + policies | — | ✅ |
| Policy-based queries | ✅ | — |
| Query interface | — | ✅ |
| Multiple catalog protocols | Possible | Possible |
| Pluggable storage system | ✅ | ✅ (schemeless) |

### Deployment Considerations

Crawlers are designed to be **ephemeral, scalable, and low-maintenance** — instantiated when work is available, they crawl and finish.

**Tuning variables:**
- **Number of crawlers** — balance between participant count and catalog update frequency. Many participants with frequent updates warrant more crawlers.
- **ExecutionPlan** — FC supports periodic execution out-of-the-box. Custom plans can be implemented for event-driven triggers (dataspace events, manual API triggers).

---

## 9. Distributions, Deployment, and Operations

### Using Bills-of-Material (BOMs)

BOMs are meta-modules declaring dependencies onto other modules. The EDC project provides several key BOMs:

**Connector:**
- `controlplane-base-bom` — base BOM for control plane without IdentityService.
- `controlplane-dcp-bom` — control plane with DCP as identity system.
- `dataplane-base-bom` — runnable data plane with HTTP transfer pipelines.

**Federated Catalog:**
- `federatedcatalog-base-bom` — base FC modules (no IdentityService).
- `federatedcatalog-dcp-bom` — adds DCP to FC.

**Identity Hub:**
- `identityhub-base-bom` — base IH (no DCP).
- `identityhub-bom` — default IH runtime with DCP (no embedded STS).
- `identityhub-with-sts-bom` — IH with