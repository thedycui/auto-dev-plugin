# Tech Stack: Java / Maven

## Variables
- language: Java 8
- build_cmd: mvn compile -q
- test_cmd: mvn test -q
- test_single_cmd: mvn test -Dtest={test_class} -q
- lang_checklist: code-review-java8.md
- test_dir: src/test/java/
- source_dir: src/main/java/

## Build Notes
- Requires Java 8 (JAVA_HOME must point to JDK 8)
- Use `mvn clean package -P {profile}` for full build with profile (development/test/product)
- Build warnings are acceptable; build errors are not

## Test Notes
- Tests use TestNG (check for testng.xml)
- Base test class: AbstractTest with Spring context
- Integration tests may require `-P test` profile for database connectivity
