FROM eclipse-temurin:17-jre

WORKDIR /app

# Fat JAR produced by `./gradlew :launchers:connector:shadowJar`
COPY build/libs/connector.jar /app/connector.jar

# The config file is injected by docker-compose via a bind mount
# onto /app/config/config.properties.
ENV EDC_FS_CONFIG=/app/config/config.properties

ENTRYPOINT ["sh", "-c", "java -Dedc.fs.config=${EDC_FS_CONFIG} -jar /app/connector.jar"]
