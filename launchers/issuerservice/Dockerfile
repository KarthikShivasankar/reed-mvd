FROM eclipse-temurin:17-jre

WORKDIR /app

# Fat JAR produced by `./gradlew :launchers:issuerservice:shadowJar`
COPY build/libs/issuerservice.jar /app/issuerservice.jar

# The config file is injected by docker-compose via a bind mount
# onto /app/config/config.properties.
ENV EDC_FS_CONFIG=/app/config/config.properties

ENTRYPOINT ["sh", "-c", "java -Dedc.fs.config=${EDC_FS_CONFIG} -jar /app/issuerservice.jar"]
