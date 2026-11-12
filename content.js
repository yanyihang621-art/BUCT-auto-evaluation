/**
 * 麦可思教学质量管理平台 (mycospxk.com) 内容脚本 (Content Script)
 * 负责：
 *   1. 将 evaluator.js 与 page-agent.js 注入页面主世界 (MAIN World)
 *   2. 在页面右上角渲染可拖拽的悬浮控制面板与“第一轮测试答案核对弹窗”
 *   3. 与扩展 Popup 弹窗同步配置与第一轮测试答案数据
 */
(function () {
  'use strict';

  if (window.__MYCOS_CONTENT_SCRIPT_INITIALIZED__) return;
  window.__MYCOS_CONTENT_SCRIPT_INITIALIZED__ = true;

  let lastTestReport = null;
  let userConfig = {
    avoidFullMarkIfForbidden: false,
    customComment:
      '老师治学严谨，严格遵守教学规定，无任何违规现象；备课十分充分，课程内容很丰富，讲解深入浅出、条理清晰，课堂收获很大，非常满意！'
  };

  /**
   * 注入主世界脚本 (evaluator.js -> page-agent.js)
   */
  function injectMainWorldScripts() {
    const scripts = ['evaluator.js', 'page-agent.js'];
    let chain = Promise.resolve();

    scripts.forEach((file) => {
      chain = chain.then(
        () =>
          new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = chrome.runtime.getURL(file);
            s.charset = 'utf-8';
            s.onload = () => {
              s.remove();
              resolve();
            };
            s.onerror = () => resolve();
            (document.head || document.documentElement).appendChild(s);
          })
      );
    });
  }

  /**
   * 向页面主世界发送指令
   */
  function sendToPageAgent(action, options = {}) {
    window.postMessage(
      {
        source: 'MYCOS_EVAL_CONTENT_SCRIPT',
        action,
        options: {
          ...userConfig,
          ...options
        }
      },
      '*'
    );
  }

  /**
   * 将第一轮测试报告格式化为清晰的 Markdown 文本
   */
  function formatReportToMarkdown(report) {
    if (!report || !Array.isArray(report.questions)) return '暂无测试数据';
    const lines = [];
    lines.push(`# 📋 第一轮教评测试答案核对单（仅填写·未提交）`);
    lines.push(`- **问卷名称**：${report.questionnaireName || '教学质量评价问卷'}`);
    if (report.courseName || report.teacherName) {
      lines.push(`- **当前课程/教师**：${[report.courseName, report.teacherName].filter(Boolean).join(' / ')}`);
    }
    lines.push(`- **题目总数**：共 ${report.questions.length} 题`);
    lines.push(`- **提交状态**：🛡️ **测试模式（仅在页面勾选填写，未提交问卷）**`);
    lines.push('');
    lines.push(`| 题号 | 题型 | 题目内容 | 候选选项 | ✅ 插件已选理想答案 | 决策依据 |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);

    report.questions.forEach((q, idx) => {
      const qNum = q.questionNumber || idx + 1;
      const reqTag = q.isRequired ? '*(必答)* ' : '*(非必答·直接不填)* ';
      const optsStr = Array.isArray(q.allOptions) && q.allOptions.length > 0
        ? q.allOptions.map((o) => o.text).join(' / ')
        : '-';
      const chosenStr = `**${q.summaryText || (q.selectedOptionTexts || []).join('、')}**`;
      const cleanTitle = String(q.title || '').replace(/\|/g, '｜');
      const cleanOpts = String(optsStr || '').replace(/\|/g, '｜');
      const cleanChosen = String(chosenStr || '').replace(/\|/g, '｜');
      const cleanReason = String(q.reason || '').replace(/\|/g, '｜');
      lines.push(`| 第${qNum}题 | ${q.typeName} | ${reqTag}${cleanTitle} | ${cleanOpts} | ${cleanChosen} | ${cleanReason} |`);
    });

    return lines.join('\n');
  }

  /**
   * 创建右侧悬浮控制面板与测试结果核对弹窗
   */
  function createFloatingUI() {
    if (document.getElementById('mycos-auto-eval-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'mycos-auto-eval-panel';
    panel.innerHTML = `
      <div class="mycos-eval-header" id="mycos-eval-drag-handle">
        <div class="mycos-eval-title">
          <span class="mycos-eval-dot"></span>
          <span>自动理想化教评助手</span>
        </div>
        <button class="mycos-eval-minimize" id="mycos-eval-min-btn" title="折叠/展开">−</button>
      </div>
      <div class="mycos-eval-body" id="mycos-eval-body">
        <div class="mycos-eval-status" id="mycos-eval-status-box">
          就绪：可先进行【第一轮测试】（不提交）核对答案
        </div>
        <div class="mycos-eval-actions">
          <button class="mycos-btn mycos-btn-test" id="mycos-btn-test">
            🧪 第一轮测试（仅填写·不提交）
          </button>
          <button class="mycos-btn mycos-btn-auto" id="mycos-btn-auto">
            🚀 自动完成全部教评（自动提交）
          </button>
          <button class="mycos-btn mycos-btn-stop" id="mycos-btn-stop" style="display:none;">
            ⏹️ 停止自动运行
          </button>
          <button class="mycos-btn mycos-btn-view" id="mycos-btn-view-report" style="display:none;">
            📋 查看第一轮测试答案核对单
          </button>
        </div>
        <details class="mycos-eval-settings">
          <summary>⚙️ 理想化策略与评语设置</summary>
          <div class="mycos-setting-item">
            <label>
              <input type="checkbox" id="mycos-opt-avoid-full" />
              <span>仅当学校禁止满分/全同选项时微调最后1题（默认关闭，100%全选最高理想项）</span>
            </label>
          </div>
          <div class="mycos-setting-item">
            <div class="mycos-setting-label">主观题理想好评模板：</div>
            <textarea id="mycos-opt-comment" rows="3"></textarea>
          </div>
        </details>
        <div class="mycos-eval-log" id="mycos-eval-log"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // 创建测试答案核对弹窗
    const modal = document.createElement('div');
    modal.id = 'mycos-eval-report-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="mycos-modal-backdrop" id="mycos-modal-backdrop"></div>
      <div class="mycos-modal-card">
        <div class="mycos-modal-header">
          <div>
            <h3>📋 第一轮测试答案核对单（测试模式：未提交问卷）</h3>
            <p id="mycos-modal-subtitle">所有选项均已按“非常满意、没有违反规定、课程很丰富”等最高理想化标准勾选</p>
          </div>
          <button class="mycos-modal-close" id="mycos-modal-close">×</button>
        </div>
        <div class="mycos-modal-body" id="mycos-modal-body"></div>
        <div class="mycos-modal-footer">
          <button class="mycos-btn mycos-btn-copy" id="mycos-btn-copy-md">📋 一键复制答案（Markdown）</button>
          <button class="mycos-btn mycos-btn-auto" id="mycos-modal-confirm-auto">✅ 答案符合预期，开始自动完成全部教评</button>
          <button class="mycos-btn mycos-btn-secondary" id="mycos-modal-close-btn">关闭窗口（留在页面检查）</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 绑定配置项
    const avoidFullInput = document.getElementById('mycos-opt-avoid-full');
    const commentInput = document.getElementById('mycos-opt-comment');
    avoidFullInput.checked = userConfig.avoidFullMarkIfForbidden;
    commentInput.value = userConfig.customComment;

    avoidFullInput.addEventListener('change', () => {
      userConfig.avoidFullMarkIfForbidden = avoidFullInput.checked;
      saveConfig();
    });
    commentInput.addEventListener('input', () => {
      userConfig.customComment = commentInput.value;
      saveConfig();
    });

    // 折叠/展开
    const minBtn = document.getElementById('mycos-eval-min-btn');
    const bodyEl = document.getElementById('mycos-eval-body');
    minBtn.addEventListener('click', () => {
      const hidden = bodyEl.style.display === 'none';
      bodyEl.style.display = hidden ? 'block' : 'none';
      minBtn.textContent = hidden ? '−' : '+';
    });

    // 按钮事件
    document.getElementById('mycos-btn-test').addEventListener('click', () => {
      appendLog('info', '🧪 启动第一轮测试：自动填写理想化答案，严格禁止提交...');
      sendToPageAgent('RUN_TEST_ROUND');
    });

    document.getElementById('mycos-btn-auto').addEventListener('click', () => {
      document.getElementById('mycos-btn-stop').style.display = 'block';
      document.getElementById('mycos-btn-auto').style.display = 'none';
      sendToPageAgent('RUN_AUTO_ALL');
    });

    document.getElementById('mycos-btn-stop').addEventListener('click', () => {
      document.getElementById('mycos-btn-stop').style.display = 'none';
      document.getElementById('mycos-btn-auto').style.display = 'block';
      sendToPageAgent('STOP_AUTO');
    });

    document.getElementById('mycos-btn-view-report').addEventListener('click', () => {
      if (lastTestReport) renderReportModal(lastTestReport);
    });

    // 弹窗事件
    const closeModal = () => {
      modal.style.display = 'none';
    };
    document.getElementById('mycos-modal-close').addEventListener('click', closeModal);
    document.getElementById('mycos-modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('mycos-modal-backdrop').addEventListener('click', closeModal);

    document.getElementById('mycos-btn-copy-md').addEventListener('click', () => {
      const md = formatReportToMarkdown(lastTestReport);
      navigator.clipboard.writeText(md).then(() => {
        const copyBtn = document.getElementById('mycos-btn-copy-md');
        const oldText = copyBtn.textContent;
        copyBtn.textContent = '✅ 已复制到剪贴板！';
        setTimeout(() => {
          copyBtn.textContent = oldText;
        }, 2000);
      });
    });

    document.getElementById('mycos-modal-confirm-auto').addEventListener('click', () => {
      closeModal();
      document.getElementById('mycos-btn-stop').style.display = 'block';
      document.getElementById('mycos-btn-auto').style.display = 'none';
      sendToPageAgent('RUN_AUTO_ALL');
    });

    // 支持面板拖拽
    enableDrag(panel, document.getElementById('mycos-eval-drag-handle'));
  }

  function enableDrag(panel, handle) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origRight = 16;
    let origTop = 70;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      origRight = window.innerWidth - rect.right;
      origTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = `${Math.max(4, origRight - dx)}px`;
      panel.style.top = `${Math.max(4, origTop + dy)}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function updateStatusText(text, type = 'normal') {
    const box = document.getElementById('mycos-eval-status-box');
    if (!box) return;
    box.textContent = text;
    box.className = `mycos-eval-status mycos-status-${type}`;
  }

  function appendLog(level, message) {
    const logEl = document.getElementById('mycos-eval-log');
    if (!logEl) return;
    const item = document.createElement('div');
    item.className = `mycos-log-item mycos-log-${level}`;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    item.textContent = `[${time}] ${message}`;
    logEl.prepend(item);
  }

  /**
   * 渲染第一轮测试答案核对弹窗
   */
  function renderReportModal(report) {
    const modal = document.getElementById('mycos-eval-report-modal');
    const body = document.getElementById('mycos-modal-body');
    const subtitle = document.getElementById('mycos-modal-subtitle');
    if (!modal || !body) return;

    const courseTeacher = [report.courseName, report.teacherName].filter(Boolean).join(' · ');
    subtitle.textContent = `${report.questionnaireName || '期中/期末学生教评问卷'}${
      courseTeacher ? ` （${courseTeacher}）` : ''
    } — 共 ${report.questions.length} 道题，已全部在页面填好且未提交`;

    const rowsHtml = (report.questions || [])
      .map((q, idx) => {
        const qNum = q.questionNumber || idx + 1;
        const reqBadge = q.isRequired
          ? '<span class="mycos-badge mycos-badge-req">必答</span>'
          : '<span class="mycos-badge mycos-badge-opt">非必答</span>';

        const isSkipped = !q.isRequired || String(q.summaryText).includes('不填写');
        const chosenIcon = isSkipped ? '⚪ ' : '✅ ';
        const chosenClass = isSkipped ? 'mycos-chosen-skipped' : 'mycos-chosen-main';

        const optionsHtml = Array.isArray(q.allOptions) && q.allOptions.length > 0
          ? q.allOptions
              .map((o) => {
                const isSelected = (q.selectedOptionTexts || []).includes(o.text);
                return `<span class="mycos-opt-chip ${isSelected ? 'mycos-opt-chip-selected' : ''}">${
                  isSelected ? '✅ ' : ''
                }${escapeHtml(o.text)}</span>`;
              })
              .join(' ')
          : '<span style="color:#94a3b8;font-size:12px;">无选项/直接留空</span>';

        return `
          <tr>
            <td class="mycos-td-num">第 ${qNum} 题<br/><span class="mycos-td-type">${escapeHtml(q.typeName)}</span></td>
            <td class="mycos-td-title">${reqBadge} ${escapeHtml(q.title)}</td>
            <td class="mycos-td-opts">${optionsHtml}</td>
            <td class="mycos-td-chosen">
              <div class="${chosenClass}">${chosenIcon}${escapeHtml(q.summaryText || (q.selectedOptionTexts || []).join('、'))}</div>
              <div class="mycos-chosen-reason">${escapeHtml(q.reason || '')}</div>
            </td>
          </tr>
        `;
      })
      .join('');

    body.innerHTML = `
      <div class="mycos-report-summary">
        <span>🛡️ <strong>安全状态</strong>：已开启测试防提交保护（仅填写，未提交）</span>
        <span>📊 <strong>题目数</strong>：${report.questions.length} 题</span>
        <span>✨ <strong>理想化匹配率</strong>：100%</span>
      </div>
      <div class="mycos-table-wrap">
        <table class="mycos-report-table">
          <thead>
            <tr>
              <th style="width:82px;">题号/题型</th>
              <th style="width:32%;">题目内容</th>
              <th style="width:33%;">候选选项（绿色为插件选中项）</th>
              <th style="width:25%;">插件第一轮测试答案 & 依据</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    modal.style.display = 'flex';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function saveConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ mycosUserConfig: userConfig });
    }
  }

  function loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['mycosUserConfig', 'mycosLastTestReport'], (res) => {
        if (res && res.mycosUserConfig) {
          userConfig = { ...userConfig, ...res.mycosUserConfig };
          const avoidEl = document.getElementById('mycos-opt-avoid-full');
          const commentEl = document.getElementById('mycos-opt-comment');
          if (avoidEl) avoidEl.checked = !!userConfig.avoidFullMarkIfForbidden;
          if (commentEl && userConfig.customComment) commentEl.value = userConfig.customComment;
        }
        if (res && res.mycosLastTestReport) {
          lastTestReport = res.mycosLastTestReport;
          const viewBtn = document.getElementById('mycos-btn-view-report');
          if (viewBtn) viewBtn.style.display = 'block';
        }
      });
    }
  }

  /**
   * 监听来自 Page Agent 的消息
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'MYCOS_EVAL_PAGE_AGENT') {
      return;
    }

    const { type, payload } = event.data;

    if (type === 'STATUS_UPDATE') {
      updateStatusText(payload.message, payload.status);
      appendLog('info', payload.message);
    } else if (type === 'LOG') {
      appendLog(payload.level || 'info', payload.message);
    } else if (type === 'TEST_COMPLETE') {
      lastTestReport = payload.report;
      const md = formatReportToMarkdown(lastTestReport);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          mycosLastTestReport: lastTestReport,
          mycosLastTestMarkdown: md
        });
      }
      updateStatusText(
        `✅ 第一轮测试完成！已自动填好 ${lastTestReport.questions.length} 道题（未提交），请核对答案。`,
        'success'
      );
      appendLog(
        'success',
        `🎉 第一轮测试完成（共 ${lastTestReport.questions.length} 题，未提交问卷），已弹出答案核对单。`
      );
      const viewBtn = document.getElementById('mycos-btn-view-report');
      if (viewBtn) viewBtn.style.display = 'block';
      renderReportModal(lastTestReport);
    } else if (type === 'TEST_ERROR') {
      updateStatusText(`⚠️ ${payload.message}`, 'error');
      appendLog('error', payload.message);
      document.getElementById('mycos-btn-stop').style.display = 'none';
      document.getElementById('mycos-btn-auto').style.display = 'block';
    } else if (type === 'AUTO_COMPLETE_DONE') {
      updateStatusText(payload.message, 'success');
      appendLog('success', payload.message);
      document.getElementById('mycos-btn-stop').style.display = 'none';
      document.getElementById('mycos-btn-auto').style.display = 'block';
    }
  });

  /**
   * 监听来自 Popup 扩展弹窗的指令
   */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'TRIGGER_TEST') {
        sendToPageAgent('RUN_TEST_ROUND', msg.options || {});
        sendResponse({ ok: true });
      } else if (msg.action === 'TRIGGER_AUTO_ALL') {
        document.getElementById('mycos-btn-stop').style.display = 'block';
        document.getElementById('mycos-btn-auto').style.display = 'none';
        sendToPageAgent('RUN_AUTO_ALL', msg.options || {});
        sendResponse({ ok: true });
      } else if (msg.action === 'TRIGGER_STOP') {
        document.getElementById('mycos-btn-stop').style.display = 'none';
        document.getElementById('mycos-btn-auto').style.display = 'block';
        sendToPageAgent('STOP_AUTO');
        sendResponse({ ok: true });
      } else if (msg.action === 'GET_LAST_REPORT') {
        sendResponse({
          report: lastTestReport,
          markdown: lastTestReport ? formatReportToMarkdown(lastTestReport) : ''
        });
      }
      return true;
    });
  }

  // 初始化
  injectMainWorldScripts();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createFloatingUI();
      loadConfig();
    });
  } else {
    createFloatingUI();
    loadConfig();
  }
})();
