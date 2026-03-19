# Code Review Checklist (Java 8 Specific)

## A. 资源管理
- [ ] AutoCloseable 资源用 try-with-resources？
- [ ] 数据库连接/ResultSet/Statement 正确关闭？
- [ ] 大对象（byte[]、集合）作用域尽量小？
- [ ] 事件监听器/回调在不需要时取消注册？

## B. Optional & Null 处理
- [ ] Optional 用于返回值，不用于字段和参数？
- [ ] Optional 不用 == null 比较，用 isPresent()/orElse()/map()？
- [ ] null 返回值尽量替换为 Optional 或空集合？

## C. Stream API
- [ ] Stream 操作有终止操作？
- [ ] I/O-based Stream（Files.lines() 等）正确关闭？
- [ ] Lambda 简短可读（> 3 行提取为命名方法）？
- [ ] 方法引用在提高可读性时使用？
- [ ] parallel() 只用于 CPU 密集 + 大数据集？
- [ ] Stream 中间操作无副作用？

## D. 并发 & 线程安全
> 适用条件：变更涉及多线程、共享状态、static 字段、ExecutorService、parallel Stream 时检查
- [ ] 静态方法/字段线程安全？
- [ ] Servlet/Controller 无可变实例字段？
- [ ] ConcurrentHashMap 用 computeIfAbsent() 而非 containsKey()+put()？
- [ ] 不在 CachedThreadPool 中做网络 I/O？
- [ ] 不在 ForkJoinPool / parallel Stream 中做阻塞 I/O？
- [ ] ExecutorService 有正确关闭？
- [ ] 无死锁风险（嵌套锁顺序一致）？
- [ ] InterruptedException 正确处理（恢复中断状态）？
- [ ] DateFormat 在共享实例上同步或使用 ThreadLocal？

## E. 性能
> 适用条件：变更涉及循环、字符串操作、集合处理、日志热路径时检查
- [ ] 循环中字符串拼接用 StringBuilder？
- [ ] 合适的数据结构（HashMap vs TreeMap, ArrayList vs LinkedList）？
- [ ] 循环中无不必要的对象分配？
- [ ] 日志用参数化消息或 isDebugEnabled() 保护？
