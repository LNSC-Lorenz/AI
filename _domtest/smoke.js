const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../LNSC-Doku/Jira/Jira使用说明.html', 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://jira.example.com/guide', // 避免 about:blank 下 history.replaceState 的 jsdom 缺陷
  beforeParse(w) {
    w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() { } unobserve() { } disconnect() { } };
    w.HTMLElement.prototype.scrollIntoView = function () { };
    if (!w.requestAnimationFrame) w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      const col = this.closest ? this.closest('.col') : null;
      const idx = col ? [...w.document.querySelectorAll('.col')].indexOf(col) : 0;
      return { left: idx * 250, top: 100, width: 200, height: 120 };
    };
  }
});
const { window } = dom;
const d = window.document;
window.addEventListener('error', e => errors.push('script error: ' + e.message));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}

const coachText = () => d.getElementById('coachText').textContent;
const chipsOn = () => d.querySelectorAll('#stepline .chip.on').length;

(async () => {
  await sleep(300); // 等待 setCoach 的 180ms 淡入完成

  console.log('\n[1] 静态结构校验');
  const cols = [...d.querySelectorAll('.board .col')];
  check('看板为 4 列', cols.length === 4);
  const names = ['📥 Backlog', '📝 To Do', '⚙️ In Progress', '✅ Done'];
  check('列名: Backlog/To Do/In Progress/Done',
    cols.every((c, i) => c.querySelector('.col-head').textContent.replace(/[0-9]/g, '').trim() === names[i]));
  check('初始 coach 已给出欢迎引导', coachText().includes('欢迎'));
  check('初始: 卡片尚未激活(show 类未加)', !d.getElementById('demoCard').classList.contains('show'));
  check('初始: demoCard 位于 To Do 列', d.getElementById('demoCard').parentElement === cols[1].querySelector('.col-body'));
  check('初始: 无 chip 点亮', chipsOn() === 0);
  check('初始: To Do 计数=1（初始修复）', cols[1].querySelector('.cnt').textContent === '1');
  check('chip 共 6 个(准备+5步)', d.querySelectorAll('#stepline .chip').length === 6);
  const navHrefs = [...d.querySelectorAll('.nav a')].map(a => a.getAttribute('href'));
  check('全部导航锚点可解析: ' + navHrefs.join(','), navHrefs.every(h => d.querySelector(h) !== null));
  const neededIds = ['btnPlay','btnNext','btnPrev','btnReset','speed','btnCreate','board','confetti','stepline','coachText','demoCard','demoAvatar','demoSprint','demoBar'];
  const missing = neededIds.filter(id => !d.getElementById(id));
  check('JS 引用的 ID 全部存在 (缺失:' + (missing.join(',')||'无') + ')', missing.length === 0);

  console.log('\n[2] 导航点击');
  d.querySelector('.nav a[href="#shortcuts"]').click();
  check('快捷键导航点击无错误', errors.length === 0);

  console.log('\n[3] 单步演示：创建 & 分配（render 路径）');
  const card = d.getElementById('demoCard');
  d.getElementById('btnNext').click(); // → step1 创建
  await sleep(300);
  check('step1: coach=创建 Issue', coachText().includes('创建'));
  check('step1: chip 点亮 2 个(准备+1创建)', chipsOn() === 2);
  check('step1: 卡片显示且在 To Do 列', card.classList.contains('show') && card.parentElement === cols[1].querySelector('.col-body'));
  check('step1: 头像尚未出现', !d.getElementById('demoAvatar').classList.contains('show'));
  d.getElementById('btnNext').click(); // → step2 分配
  await sleep(300);
  check('step2: coach=分配负责人', coachText().includes('分配'));
  check('step2: chip 点亮 3 个', chipsOn() === 3);
  check('step2: 头像显示', d.getElementById('demoAvatar').classList.contains('show'));
  check('step2: sprint 标签显示', d.getElementById('demoSprint').classList.contains('show'));
  check('step2: 卡片仍在 To Do 列', card.parentElement === cols[1].querySelector('.col-body'));
  check('step2: To Do 计数=1', cols[1].querySelector('.cnt').textContent === '1');
  check('无脚本错误', errors.length === 0);

  console.log('\n[4] 动画路径：拖拽模拟（每步约 1.1s）');
  d.getElementById('btnNext').click(); // → step3 开始开发（To Do → In Progress 动画）
  await sleep(1300);
  check('step3: coach=开始开发', coachText().includes('开始'));
  check('step3: 卡片移入 In Progress 列', card.parentElement === cols[2].querySelector('.col-body'));
  check('step3: 拖拽类已清除', !card.classList.contains('dragging') && !card.classList.contains('active'));
  d.getElementById('btnNext').click(); // → step4 开发测试（同列，立即渲染）
  await sleep(300);
  check('step4: coach=开发测试', coachText().includes('测试'));
  check('step4: 进度条 80%', d.getElementById('demoBar').style.width === '80%');
  check('step4: 卡片仍在 In Progress 列', card.parentElement === cols[2].querySelector('.col-body'));
  d.getElementById('btnNext').click(); // → step5 完成（In Progress → Done 动画）
  await sleep(1600); // 跨列动画 1.1s + burst 延迟 0.4s
  check('step5: coach=完成', coachText().includes('完成'));
  check('step5: 卡片在 Done 列且有 done 类', card.parentElement === cols[3].querySelector('.col-body') && card.classList.contains('done'));
  check('step5: 全部 6 个 chip 点亮', chipsOn() === 6);
  check('step5: 彩带已生成', d.querySelectorAll('#confetti i').length > 0);
  check('step5: Done 计数=1', cols[3].querySelector('.cnt').textContent === '1');
  check('step5: 播放按钮复位为「播放」', d.getElementById('btnPlay').textContent === '▶ 播放');
  d.getElementById('btnNext').click(); // 已到末尾，应无反应
  await sleep(200);
  check('step5 后继续下一步: 无错误且状态不变', errors.length === 0 && card.classList.contains('done'));
  check('动画全程: 零脚本错误', errors.length === 0);

  console.log('\n[5] 播放按钮全流程（约 13.5s）');
  d.getElementById('btnPlay').click();
  await sleep(500);
  check('播放启动: 重置并走到 step1', chipsOn() === 2 && card.classList.contains('show'));
  await sleep(2700);
  check('播放 2.7s: 自动推进到 step2', chipsOn() === 3 && coachText().includes('分配'));
  await sleep(1300); // t≈4.5s < 5.2s(第3次tick)，不应推进
  check('播放 4.5s: 未到第3次tick仍停 step2', chipsOn() === 3);
  await sleep(800); // t≈5.3s > 5.2s，第3次tick 触发(跨列动画 1.1s)
  await sleep(1200);
  check('播放 6.5s: 已推进到 step3(In Progress)', chipsOn() === 4 && card.parentElement === cols[2].querySelector('.col-body'));
  await sleep(6700); // t≈13.2s：tick4≈7.8s、tick5≈10.4s(跨列) 应走完 step4→step5
  check('播放完成: step5 到达', chipsOn() === 6 && card.parentElement === cols[3].querySelector('.col-body') && card.classList.contains('done'));
  check('播放完成: 引擎自动停止(按钮=播放)', d.getElementById('btnPlay').textContent === '▶ 播放');
  await sleep(3200); // 再等一个 tick 周期，验证 stopPlay 后不再推进
  check('播放完成后: 状态保持稳定(stepPlay 末尾已 stopPlay)', chipsOn() === 6 && d.getElementById('btnPlay').textContent === '▶ 播放');
  check('播放全程: 零脚本错误', errors.length === 0);

  console.log('\n[6] 重置');
  d.getElementById('btnReset').click();
  await sleep(300);
  check('重置: 无 chip 点亮', chipsOn() === 0);
  check('重置: 卡片隐藏', !card.classList.contains('show'));
  check('重置: coach 回到欢迎语', coachText().includes('欢迎'));

  console.log('\n[7] 手动创建 & 拖拽 Issue');
  d.getElementById('btnCreate').click();
  d.getElementById('btnCreate').click();
  await sleep(300); // 等 setCoach 的 180ms 延迟落地
  const todo = cols[1].querySelector('.col-body');
  // 重置后 demoCard 仍在 To Do 列（隐藏状态），创建 2 张新卡后共 3 张
  check('创建: To Do 新增 2 张卡片', todo.querySelectorAll('.jcard').length === 3);
  check('计数更新为 3', cols[1].querySelector('.cnt').textContent === '3');
  check('coach 提示创建成功', coachText().includes('成功'));
  const newCard = todo.querySelector('.jcard');
  newCard.dispatchEvent(new window.Event('dragstart', { bubbles: true }));
  cols[3].dispatchEvent(new window.Event('dragover', { bubbles: true, cancelable: true }));
  cols[3].dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));
  check('拖拽: 新卡片移入 Done 列', newCard.parentElement === cols[3].querySelector('.col-body'));
  check('拖拽: done 类 + pop 类', newCard.classList.contains('done') && newCard.classList.contains('pop'));
  check('拖拽: 彩带再次生成', d.querySelectorAll('#confetti i').length > 0);
  check('拖拽: Done 计数=1', cols[3].querySelector('.cnt').textContent === '1');

  console.log('\n[8] FAQ 手风琴');
  const faqs = d.querySelectorAll('.faq-item');
  faqs[0].querySelector('.faq-q').click();
  check('FAQ1 展开', faqs[0].classList.contains('open'));
  faqs[2].querySelector('.faq-q').click();
  check('FAQ3 展开且 FAQ1 收起', faqs[2].classList.contains('open') && !faqs[0].classList.contains('open'));
  faqs[2].querySelector('.faq-q').click();
  check('再次点击收起', !faqs[2].classList.contains('open'));

  console.log('\n[9] 错误汇总');
  check('运行期间零脚本错误' + (errors.length ? ' -> ' + errors.join(' | ') : ''), errors.length === 0);

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
