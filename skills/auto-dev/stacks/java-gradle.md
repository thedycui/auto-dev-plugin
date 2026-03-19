# Tech Stack: Java / Gradle

## Variables
- language: Java
- build_cmd: ./gradlew compileJava -q
- test_cmd: ./gradlew test -q
- test_single_cmd: ./gradlew test --tests "{test_class}" -q
- lang_checklist: code-review-java8.md
- test_dir: src/test/java/
- source_dir: src/main/java/

## Build Notes
- Check `gradle.properties` for Java version requirements
- Use `./gradlew build` for full build including tests
- Gradle wrapper (gradlew) preferred over system gradle

## Test Notes
- Check for JUnit 4/5 or TestNG configuration
- Test reports in build/reports/tests/
