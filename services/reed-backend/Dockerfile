FROM eclipse-temurin:17-jre

WORKDIR /app

# Boot JAR produced by `./gradlew :services:reed-backend:bootJar`
COPY build/libs/reed-backend.jar /app/reed-backend.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/reed-backend.jar"]
