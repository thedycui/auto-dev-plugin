# Code Review Checklist (TypeScript/JavaScript Specific)

## A. 类型安全
- [ ] 避免使用 any 类型？
- [ ] 接口/类型定义完整（不用 Partial 逃避）？
- [ ] 联合类型正确缩窄（type narrowing）？
- [ ] 泛型使用得当？

## B. 异步处理
> 适用条件：变更涉及 async/await、Promise、fetch、API 调用时重点检查
- [ ] async/await 正确使用（不忘 await）？
- [ ] Promise 错误被 catch 处理？
- [ ] 无 unhandled promise rejection？
- [ ] 并发请求使用 Promise.all / Promise.allSettled？
- [ ] 异步循环不用 forEach + async（用 for...of）？

## C. 内存 & 资源
> 适用条件：变更涉及事件监听、定时器、订阅、大数据结构时检查
- [ ] 事件监听器在组件卸载时移除？
- [ ] setInterval/setTimeout 正确清理？
- [ ] 大数组/对象在不需要时置空？
- [ ] 订阅（Observable/EventEmitter）正确取消？

## D. 安全
- [ ] 不使用 eval() 或 Function()？
- [ ] innerHTML 不接受用户输入（用 textContent）？
- [ ] 外部数据经过验证和转义？
- [ ] 依赖无已知漏洞（npm audit）？

## E. 模块 & 导入
- [ ] 无循环依赖？
- [ ] 无未使用的导入？
- [ ] 默认导出和命名导出使用一致？

## F. 错误处理
- [ ] try/catch 粒度合理（不包裹整个函数）？
- [ ] 错误信息有上下文？
- [ ] 自定义错误类用于业务异常？
