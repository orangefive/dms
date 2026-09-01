/** e2e 全局收尾：清理测试环境 */
export default async function globalTeardown(): Promise<void> {
  console.log('[global-teardown] 测试完成');
}
