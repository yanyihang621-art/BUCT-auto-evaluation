(function () {
  'use strict';

  const statusText = document.getElementById('status-text');
  const btnTest = document.getElementById('btn-test');
  const btnAuto = document.getElementById('btn-auto');
  const btnCopy = document.getElementById('btn-copy');
  const previewBox = document.getElementById('preview-box');

  let cachedMarkdown = '';

  function renderReportPreview(report, markdown) {
    if (!report || !Array.isArray(report.questions) || report.questions.length === 0) return;
    cachedMarkdown = markdown || '';
    statusText.textContent = `✅ 已获取第一轮测试答案（共 ${report.questions.length} 题，未提交问卷）：`;
    btnCopy.style.display = 'flex';
    previewBox.style.display = 'block';
    previewBox.innerHTML = report.questions
      .map(
        (q, i) => `
        <div class="q-item">
          <div class="q-title">${i + 1}. [${q.typeName}] ${q.title}</div>
          <div class="q-ans">✅ 已选答案：${q.summaryText || (q.selectedOptionTexts || []).join('、')}</div>
        </div>
      `
      )
      .join('');
  }

  function sendToActiveTab(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        statusText.textContent = '⚠️ 未找到当前标签页';
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action }, (res) => {
        if (chrome.runtime.lastError) {
          statusText.textContent = '⚠️ 请先打开教学质量管理平台 (jpv2-2.mycospxk.com) 页面并刷新一次！';
          return;
        }
        if (action === 'TRIGGER_TEST') {
          statusText.textContent = '🧪 已在页面启动第一轮测试（仅填写不提交），请查看页面弹窗或稍后重新打开此窗口。';
        } else if (action === 'TRIGGER_AUTO_ALL') {
          statusText.textContent = '🚀 已启动全自动教评任务！';
        }
      });
    });
  }

  btnTest.addEventListener('click', () => sendToActiveTab('TRIGGER_TEST'));
  btnAuto.addEventListener('click', () => sendToActiveTab('TRIGGER_AUTO_ALL'));

  btnCopy.addEventListener('click', () => {
    if (!cachedMarkdown) return;
    navigator.clipboard.writeText(cachedMarkdown).then(() => {
      btnCopy.textContent = '✅ 已复制测试答案！';
      setTimeout(() => {
        btnCopy.textContent = '📋 复制第一轮测试答案（Markdown）';
      }, 2000);
    });
  });

  // 加载缓存的第一轮测试结果
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['mycosLastTestReport', 'mycosLastTestMarkdown'], (res) => {
      if (res && res.mycosLastTestReport) {
        renderReportPreview(res.mycosLastTestReport, res.mycosLastTestMarkdown);
      }
    });
  }
})();
