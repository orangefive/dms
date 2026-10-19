/**
 * 确定性测试文件顺序。
 *
 * Jest 默认按文件体积排序，顺序会随文件内容变化而漂移。
 * 本项目的 E2E 存在共享状态：`app.e2e-spec.ts` 依赖一个长期有效的管理员会话，
 * 而 `security.e2e-spec.ts` 会主动撤销会话 / 禁用账号以验证失效逻辑。
 * 若后者先执行，前者的用例会成片收到 403，产生与业务无关的假失败。
 *
 * 因此显式固定：基础套件先跑，破坏性套件后跑。
 */
const ORDER = ['app.e2e-spec.ts', 'security.e2e-spec.ts'];

class Sequencer {
  sort(tests) {
    const rank = (t) => {
      const idx = ORDER.findIndex((name) => t.path.endsWith(name));
      return idx === -1 ? ORDER.length : idx;
    };
    return [...tests].sort((a, b) => {
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.path.localeCompare(b.path);
    });
  }

  allFailedTests(tests) {
    return this.sort(tests);
  }
}

module.exports = Sequencer;
