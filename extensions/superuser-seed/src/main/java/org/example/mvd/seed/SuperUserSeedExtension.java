package org.example.mvd.seed;

import org.eclipse.edc.identityhub.spi.authentication.ServicePrincipal;
import org.eclipse.edc.identityhub.spi.participantcontext.IdentityHubParticipantContextService;
import org.eclipse.edc.identityhub.spi.participantcontext.model.KeyDescriptor;
import org.eclipse.edc.identityhub.spi.participantcontext.model.ParticipantManifest;
import org.eclipse.edc.runtime.metamodel.annotation.Inject;
import org.eclipse.edc.runtime.metamodel.annotation.Setting;
import org.eclipse.edc.spi.EdcException;
import org.eclipse.edc.spi.monitor.Monitor;
import org.eclipse.edc.spi.security.Vault;
import org.eclipse.edc.spi.system.ServiceExtension;
import org.eclipse.edc.spi.system.ServiceExtensionContext;

import java.util.List;
import java.util.Map;

/**
 * Creates the "super-user" (role admin) participant context on startup and pins its API key to
 * {@code edc.ih.api.superuser.key} (format {@code base64(super-user).<secret>}), so seed scripts can
 * call the Identity API / Issuer Admin API with a static {@code x-api-key}.
 */
public class SuperUserSeedExtension implements ServiceExtension {

    private static final String SUPER_USER = "super-user";

    @Setting(key = "edc.ih.api.superuser.key", description = "API key of the super-user: base64(super-user).<secret>")
    private String superUserKey;

    @Inject
    private IdentityHubParticipantContextService participantContextService;
    @Inject
    private Vault vault;
    @Inject
    private Monitor monitor;

    @Override
    public String name() {
        return "REED super-user seed";
    }

    @Override
    public void start() {
        var existing = participantContextService.getParticipantContext(SUPER_USER);
        if (existing.failed()) {
            participantContextService.createParticipantContext(ParticipantManifest.Builder.newInstance()
                            .participantContextId(SUPER_USER)
                            .did("did:web:" + SUPER_USER) // never resolved
                            .active(true)
                            .key(KeyDescriptor.Builder.newInstance()
                                    .keyGeneratorParams(Map.of("algorithm", "EdDSA", "curve", "Ed25519"))
                                    .keyId(SUPER_USER + "-key")
                                    .privateKeyAlias(SUPER_USER + "-alias")
                                    .build())
                            .roles(List.of(ServicePrincipal.ROLE_ADMIN))
                            .build())
                    .orElseThrow(f -> new EdcException("Cannot create super-user: " + f.getFailureDetail()));
        }
        var pc = participantContextService.getParticipantContext(SUPER_USER)
                .orElseThrow(f -> new EdcException(f.getFailureDetail()));
        vault.storeSecret(pc.getParticipantContextId(), pc.getApiTokenAlias(), superUserKey)
                .orElseThrow(f -> new EdcException("Cannot store super-user key: " + f.getFailureDetail()));
        monitor.info("super-user ready (x-api-key from edc.ih.api.superuser.key)");
    }
}
