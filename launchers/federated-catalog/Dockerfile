FROM eclipse-temurin:17-jre

WORKDIR /app

COPY build/libs/federated-catalog.jar /app/federated-catalog.jar

ENV EDC_FS_CONFIG=/app/config/config.properties

ENTRYPOINT ["sh", "-c", "java -Dedc.fs.config=${EDC_FS_CONFIG} -jar /app/federated-catalog.jar"]
