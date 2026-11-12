/**
 * 麦可思教学质量管理平台 (mycospxk.com) 页面主世界代理脚本 (MAIN World Agent)
 * 负责：
 *   1. 深度读取 React 16 Fiber 树，获取 gC6G 问卷组件、o9r0 课程/教师切换组件、ee 任务列表组件的实例与完整题目数据 (state.data.Items)
 *   2. 同步调用 rc-form (setFieldsValue)、组件内部状态方法 (onChange / sliderChange / textAreaOnChange) 以及真实 DOM 事件
 *   3. 支持【第一轮测试模式（仅填写并提取完整答案核对单，严禁提交）】与【全自动连评模式（自动填写+提交+切换下一位教师/下一门课程）】
 */
(function () {
  'use strict';

  if (window.__MYCOS_AUTO_EVAL_AGENT_LOADED__) return;
  window.__MYCOS_AUTO_EVAL_AGENT_LOADED__ = true;

  let isAutoRunning = false;
  let stopRequested = false;
  let testModeSubmitBlocked = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 向 Content Script 发送状态与结果消息
   */
  function emitToContent(type, payload = {}) {
    window.postMessage(
      {
        source: 'MYCOS_EVAL_PAGE_AGENT',
        type,
        payload
      },
      '*'
    );
  }

  /**
   * 从 DOM 节点获取 React Fiber 节点
   */
  function getReactFiber(domNode) {
    if (!domNode) return null;
    const keys = Object.keys(domNode);
    for (const key of keys) {
      if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
        return domNode[key];
      }
    }
    return null;
  }

  /**
   * 遍历页面 React Fiber 树，查找关键组件实例：
   *   - gC6G: 问卷作答核心组件 (含 state.data.Items 与 props.form)
   *   - taskMain (o9r0): 课程/教师子标签管理组件 (含 state.currentCourse, state.currentTeacher)
   *   - taskList (ue/ee): 未完成课程列表组件 (含 state.taskList 或 cardClick)
   *   - subjectInstances: Map<subjectId, componentInstance> 各题目子组件实例
   */
  function findReactComponents() {
    const result = {
      questionnaireComp: null,
      taskMainComp: null,
      taskListComp: null,
      taskCardComp: null,
      subjectInstances: new Map()
    };

    const rootEl =
      document.getElementById('root') ||
      document.querySelector('[class*="index_answer-"]') ||
      document.querySelector('[class*="TaskMainContent_main-"]') ||
      document.body;

    let rootFiber = getReactFiber(rootEl);
    if (!rootFiber) {
      // 从页面中任意带有 React 属性的节点向上回溯到 Fiber Root
      const allEls = document.querySelectorAll('div, span, p, ul, li');
      for (let i = 0; i < allEls.length; i++) {
        const f = getReactFiber(allEls[i]);
        if (f) {
          rootFiber = f;
          break;
        }
      }
    }
    if (!rootFiber) return result;

    while (rootFiber.return) {
      rootFiber = rootFiber.return;
    }

    const visited = new Set();
    const stack = [rootFiber];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || visited.has(node)) continue;
      visited.add(node);

      const inst = node.stateNode;
      if (inst && typeof inst === 'object') {
        // 1. 识别 gC6G 问卷组件
        if (
          inst.state &&
          inst.state.data &&
          Array.isArray(inst.state.data.Items) &&
          inst.props &&
          inst.props.form &&
          typeof inst.getFormatAnswerData === 'function'
        ) {
          result.questionnaireComp = inst;
        }

        // 2. 识别 o9r0 (TaskMainContent) 课程/教师标签切换组件
        if (
          inst.state &&
          'currentTeacherIndex' in inst.state &&
          'currentCourseIndex' in inst.state &&
          typeof inst.onChangeTeacher === 'function'
        ) {
          result.taskMainComp = inst;
        }

        // 3. 识别 ue 任务列表容器组件
        if (
          inst.state &&
          Array.isArray(inst.state.taskList) &&
          typeof inst.getTaskList === 'function'
        ) {
          result.taskListComp = inst;
        }

        // 4. 识别 ee 课程卡片列表组件
        if (
          inst.props &&
          Array.isArray(inst.props.taskList) &&
          typeof inst.cardClick === 'function'
        ) {
          result.taskCardComp = inst;
        }

        // 5. 识别单个题目组件 (dZm7 / U/Ay / DysV / ZdiD / za / 8kT9)
        if (
          inst.props &&
          inst.props.data &&
          inst.props.data.Id !== undefined &&
          inst.props.data.SubjectType !== undefined &&
          inst.props.form
        ) {
          result.subjectInstances.set(inst.props.data.Id, inst);
        }
      }

      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }

    return result;
  }

  /**
   * 触发原生 Input / Textarea 值变更事件（兼容 React 16 ValueTracker）
   */
  function setNativeInputValue(el, value) {
    if (!el) return;
    const prototype =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * 在测试模式下拦截问卷提交方法，确保绝不向服务器发送提交请求
   */
  function installTestModeGuard(qComp) {
    testModeSubmitBlocked = true;
    if (qComp && !qComp.__originalSubmitAnswer__) {
      qComp.__originalSubmitAnswer__ = qComp.submitAnswer;
      qComp.submitAnswer = function () {
        if (testModeSubmitBlocked) {
          emitToContent('LOG', {
            level: 'warn',
            message: '🛡️ [测试模式保护] 已拦截问卷提交请求（当前为第一轮测试，不提交问卷）'
          });
          return Promise.resolve(false);
        }
        return qComp.__originalSubmitAnswer__.apply(this, arguments);
      };
    }
  }

  function releaseTestModeGuard(qComp) {
    testModeSubmitBlocked = false;
    if (qComp && qComp.__originalSubmitAnswer__) {
      qComp.submitAnswer = qComp.__originalSubmitAnswer__;
    }
  }

  /**
   * 将评估出的理想答案写入单个题目组件 & rc-form & DOM，并高亮显示已选答案
   */
  async function applyQuestionAnswer(item, itemEval, qComp, subjectInstances) {
    const Evaluator = window.MycosIdealEvaluator;
    const form = qComp.props.form;
    const subjInst = subjectInstances.get(item.Id);

    // 【核心策略】：如果该题是非必答题，直接不填写，清空任何预填内容
    if (!itemEval.isRequired || (!itemEval.selectedOptionIds.length && !Object.keys(itemEval.formFields).length)) {
      if (
        item.SubjectType === Evaluator.SUBJECT_TYPES.UEdito ||
        item.SubjectType === Evaluator.SUBJECT_TYPES.FeedBack
      ) {
        form.setFieldsValue({ [String(item.Id)]: '' });
        if (subjInst && typeof subjInst.textAreaOnChange === 'function') {
          subjInst.textAreaOnChange({ target: { value: '' } });
        }
      }
      return;
    }

    // 1. 单选题 (SingleSelect = 1)
    if (item.SubjectType === Evaluator.SUBJECT_TYPES.SingleSelect) {
      const chosenId = itemEval.selectedOptionIds[0];
      if (chosenId !== undefined) {
        if (subjInst && typeof subjInst.onChange === 'function') {
          subjInst.onChange({ target: { value: chosenId } });
        }
        form.setFieldsValue({ [String(item.Id)]: chosenId });

        // 若该选项附带填空框 (IsSetOptions)
        const fillKey = `${item.Id}_${chosenId}`;
        if (itemEval.extraFillFields && itemEval.extraFillFields[fillKey]) {
          await sleep(30);
          form.setFieldsValue({ [fillKey]: itemEval.extraFillFields[fillKey] });
        }
      }
      return;
    }

    // 2. 多选题 (MultiSelect = 2)
    if (item.SubjectType === Evaluator.SUBJECT_TYPES.MultiSelect) {
      const chosenIds = itemEval.selectedOptionIds || [];
      if (chosenIds.length > 0) {
        if (subjInst && typeof subjInst.onChange === 'function') {
          subjInst.onChange(chosenIds);
        }
        form.setFieldsValue({ [String(item.Id)]: chosenIds });

        for (const [fillKey, fillVal] of Object.entries(itemEval.extraFillFields || {})) {
          await sleep(30);
          form.setFieldsValue({ [fillKey]: fillVal });
        }
      }
      return;
    }

    // 3. 滑块/数字打分题 (MarkScore = 7)
    if (item.SubjectType === Evaluator.SUBJECT_TYPES.MarkScore) {
      const idealScore = itemEval.selectedOptionIds[0];
      if (idealScore !== undefined) {
        if (subjInst && typeof subjInst.sliderChange === 'function') {
          subjInst.sliderChange(idealScore);
        }
        form.setFieldsValue({ [String(item.Id)]: idealScore });
        item.hasChanged = true;

        // 检查是否触发了打分原因输入框
        await sleep(30);
        if (subjInst && typeof subjInst.getReasonFieldName === 'function') {
          const reasonField = subjInst.getReasonFieldName();
          const reasonVal =
            (itemEval.extraFillFields && itemEval.extraFillFields[reasonField]) ||
            '老师备课充分，严格遵守教学规定，课程内容很丰富，非常满意！';
          form.setFieldsValue({ [reasonField]: reasonVal });
        }
      }
      return;
    }

    // 4. 矩阵单选题 (MatrixSingle = 6) & 矩阵星级题 (MatrixScore = 5) & 填空题 (FillBlank = 3)
    if (
      item.SubjectType === Evaluator.SUBJECT_TYPES.MatrixSingle ||
      item.SubjectType === Evaluator.SUBJECT_TYPES.MatrixScore ||
      item.SubjectType === Evaluator.SUBJECT_TYPES.FillBlank
    ) {
      if (itemEval.formFields && Object.keys(itemEval.formFields).length > 0) {
        form.setFieldsValue(itemEval.formFields);
      }
      return;
    }

    // 5. 问答题 (UEdito = 4) & 意见反馈题 (FeedBack = 0)
    if (
      item.SubjectType === Evaluator.SUBJECT_TYPES.UEdito ||
      item.SubjectType === Evaluator.SUBJECT_TYPES.FeedBack
    ) {
      const textAnswer = itemEval.selectedOptionTexts[0] || '';
      if (subjInst && typeof subjInst.textAreaOnChange === 'function') {
        subjInst.textAreaOnChange({ target: { value: textAnswer } });
      } else {
        form.setFieldsValue({ [String(item.Id)]: textAnswer });
      }
      return;
    }
  }

  /**
   * 纯 DOM 兜底方案：当页面未暴露标准 gC6G 实例时，直接扫描 DOM 中的题目节点并完成理想化选择
   */
  function fillViaPureDomFallback(options = {}) {
    const Evaluator = window.MycosIdealEvaluator;
    const subjectEls = document.querySelectorAll('[class*="index_subject-"]');
    const questionsReport = [];

    subjectEls.forEach((subjEl, idx) => {
      const titleEl = subjEl.querySelector('[class*="index_title-"] [class*="index_richTextContent-"]') ||
        subjEl.querySelector('[class*="index_title-"]');
      const rawTitle = titleEl ? titleEl.innerHTML : `第${idx + 1}题`;
      const isRequired = !!subjEl.querySelector('[class*="index_necessary-"]');
      const qCtx = Evaluator.analyzeQuestionContext(rawTitle);

      const isSuggestion = /(对.*(课程|任课|授课)?(教师|老师|教学).*(意见|建议)|意见(或|和)?建议|改进(意见|建议)|您的建议)/.test(rawTitle);
      if (!isRequired || isSuggestion) {
        // 非必答问题直接跳过不填写
        const textarea = subjEl.querySelector('textarea');
        if (textarea) setNativeInputValue(textarea, '');
        questionsReport.push({
          questionNumber: idx + 1,
          title: qCtx.title,
          typeName: textarea ? '意见建议题' : '非必答题',
          isRequired: false,
          allOptions: [],
          selectedOptionTexts: [],
          summaryText: '（非必答题，直接不填写）',
          reason: isSuggestion ? '对课程/教师的建议非必答，直接不填写' : '非必答问题，直接不填写'
        });
        return;
      }

      // 1. 检查是否为单选题 (.ant-radio-wrapper)
      const radioWrappers = Array.from(subjEl.querySelectorAll('.ant-radio-wrapper'));
      if (radioWrappers.length > 0) {
        const fakeOptions = radioWrappers.map((w, oIdx) => ({
          Id: oIdx,
          Title: w.innerText || w.textContent,
          BandScore: 0,
          _el: w
        }));
        const scored = fakeOptions.map((opt, oIdx) =>
          Evaluator.scoreOption(opt, oIdx, fakeOptions.length, qCtx, false)
        );
        const sorted = [...scored].sort((a, b) => b.score - a.score);
        const chosen = sorted[0];
        if (chosen) {
          const targetWrapper = fakeOptions[chosen.optionIndex]._el;
          const radioInput = targetWrapper.querySelector('input[type="radio"]');
          if (radioInput) radioInput.click();
          else targetWrapper.click();
          targetWrapper.style.outline = '2px solid #0AC86C';
          targetWrapper.style.borderRadius = '6px';
        }
        questionsReport.push({
          questionNumber: idx + 1,
          title: qCtx.title,
          typeName: '单选题',
          isRequired,
          allOptions: scored.map((s) => ({ id: s.optionId, text: s.text, evalScore: s.score })),
          selectedOptionTexts: chosen ? [chosen.text] : [],
          summaryText: chosen ? chosen.text : '',
          reason: chosen ? chosen.reasons.join('；') : ''
        });
        return;
      }

      // 2. 检查是否为多选题 (.ant-checkbox-wrapper)
      const checkboxWrappers = Array.from(subjEl.querySelectorAll('.ant-checkbox-wrapper'));
      if (checkboxWrappers.length > 0) {
        const fakeOptions = checkboxWrappers.map((w, oIdx) => ({
          Id: oIdx,
          Title: w.innerText || w.textContent,
          BandScore: 0,
          _el: w
        }));
        const fakeItem = {
          Id: idx + 1,
          Title: rawTitle,
          SubjectType: Evaluator.SUBJECT_TYPES.MultiSelect,
          Props: { CustomAttr: { IsAllowNull: !isRequired }, Items: { Options: fakeOptions } }
        };
        const itemEval = Evaluator.evaluateQuestionItem(fakeItem, options);
        itemEval.selectedOptionIds.forEach((chosenIdx) => {
          const targetWrapper = fakeOptions[chosenIdx] && fakeOptions[chosenIdx]._el;
          if (targetWrapper && !targetWrapper.classList.contains('ant-checkbox-wrapper-checked')) {
            const cbInput = targetWrapper.querySelector('input[type="checkbox"]');
            if (cbInput) cbInput.click();
            else targetWrapper.click();
          }
          if (targetWrapper) {
            targetWrapper.style.outline = '2px solid #0AC86C';
            targetWrapper.style.borderRadius = '6px';
          }
        });
        itemEval.questionNumber = idx + 1;
        questionsReport.push(itemEval);
        return;
      }

      // 3. 检查是否为滑块/数字输入打分题
      const numInput = subjEl.querySelector('input[type="number"], [class*="index_sliderInput-"] input');
      if (numInput) {
        const maxVal = Number(numInput.getAttribute('max')) || 100;
        setNativeInputValue(numInput, String(maxVal));
        questionsReport.push({
          questionNumber: idx + 1,
          title: qCtx.title,
          typeName: '滑块打分题',
          isRequired,
          allOptions: [{ id: 'range', text: `最高分 ${maxVal}` }],
          selectedOptionTexts: [`${maxVal}分`],
          summaryText: `${maxVal}分`,
          reason: '给予满分评价'
        });
        return;
      }

      // 4. 检查是否为主观题 Textarea
      const textarea = subjEl.querySelector('textarea');
      if (textarea && !textarea.disabled) {
        const textAns = Evaluator.generateIdealTextAnswer(null, qCtx, options.customComment);
        setNativeInputValue(textarea, textAns);
        questionsReport.push({
          questionNumber: idx + 1,
          title: qCtx.title,
          typeName: '主观问答题',
          isRequired,
          allOptions: [{ id: 'text', text: '文本输入' }],
          selectedOptionTexts: [textAns],
          summaryText: textAns,
          reason: '填入理想化正面评价'
        });
      }
    });

    return {
      questionnaireName: document.querySelector('[class*="TaskMainContent_name-"], [class*="index_name-"]')?.innerText || '当前教评问卷',
      isFullMarkAllowed: true,
      isSameIndexAllowed: true,
      questions: questionsReport
    };
  }

  /**
   * 填写当前加载的问卷，并返回填写详情报告
   */
  async function fillCurrentQuestionnaire(options = {}) {
    const Evaluator = window.MycosIdealEvaluator;
    const comps = findReactComponents();
    const qComp = comps.questionnaireComp;

    if (!qComp || !qComp.state || !qComp.state.data || !Array.isArray(qComp.state.data.Items)) {
      return fillViaPureDomFallback(options);
    }

    if (options.isTestMode) {
      installTestModeGuard(qComp);
    } else {
      releaseTestModeGuard(qComp);
    }

    const qData = qComp.state.data;
    const logicsHides =
      (qComp.props.answerEvaluate && qComp.props.answerEvaluate.logicsHides) || new Set();

    // 第一遍计算并填写所有可见题目
    let evalReport = Evaluator.evaluateQuestionnaire(qData, {
      ...options,
      logicsHides
    });

    for (const itemEval of evalReport.questions) {
      const rawItem = qData.Items.find((it) => it.Id === itemEval.subjectId);
      if (rawItem) {
        await applyQuestionAnswer(rawItem, itemEval, qComp, comps.subjectInstances);
        await sleep(25);
      }
    }

    // 等待条件跳题逻辑 (dealLogicAnswers) 更新后，检查是否有新展开的题目需要补填
    await sleep(150);
    const updatedComps = findReactComponents();
    const updatedQComp = updatedComps.questionnaireComp || qComp;
    const updatedHides =
      (updatedQComp.props.answerEvaluate && updatedQComp.props.answerEvaluate.logicsHides) || new Set();

    evalReport = Evaluator.evaluateQuestionnaire(updatedQComp.state.data, {
      ...options,
      logicsHides: updatedHides
    });

    for (const itemEval of evalReport.questions) {
      const rawItem = updatedQComp.state.data.Items.find((it) => it.Id === itemEval.subjectId);
      if (rawItem) {
        await applyQuestionAnswer(rawItem, itemEval, updatedQComp, updatedComps.subjectInstances);
      }
    }

    // 附加当前课程与教师元信息
    const taskMain = updatedComps.taskMainComp;
    if (taskMain && taskMain.state) {
      const curCourse = taskMain.state.currentCourse || {};
      const curTeacher = taskMain.state.currentTeacher || {};
      evalReport.courseName = curCourse.CourseName || '';
      evalReport.teacherName = curTeacher.TeacherName || '';
      evalReport.totalCourses =
        (taskMain.props && taskMain.props.task && taskMain.props.task.CourseList && taskMain.props.task.CourseList.length) || 1;
      evalReport.totalTeachersInCourse = (curCourse.allList && curCourse.allList.length) || 1;
    } else {
      try {
        const expertTask = JSON.parse(sessionStorage.getItem('expertTask') || '{}');
        evalReport.courseName = expertTask.CourseName || '';
        evalReport.teacherName = expertTask.TeacherNames || '';
      } catch (e) {}
    }

    // 高亮页面中已选中的单选/多选框以便用户直观检查
    highlightSelectedOptionsInDom();

    return evalReport;
  }

  /**
   * 在页面上为已勾选的理想选项添加醒目的绿色边框与标记
   */
  function highlightSelectedOptionsInDom() {
    document.querySelectorAll('.ant-radio-wrapper, .ant-checkbox-wrapper').forEach((el) => {
      if (
        el.classList.contains('ant-radio-wrapper-checked') ||
        el.classList.contains('ant-checkbox-wrapper-checked')
      ) {
        el.style.outline = '2px solid #0AC86C';
        el.style.backgroundColor = 'rgba(10, 200, 108, 0.08)';
        el.style.borderRadius = '6px';
      } else {
        el.style.outline = '';
        el.style.backgroundColor = '';
      }
    });
  }

  /**
   * 如果当前处于“未完成课程列表页” (#/my-task/details/...)，自动定位或进入第一门未完成课程
   */
  async function ensureInsideQuestionnairePage() {
    let comps = findReactComponents();
    if (comps.questionnaireComp && comps.questionnaireComp.state && comps.questionnaireComp.state.data && comps.questionnaireComp.state.data.Items) {
      return { ok: true, comps };
    }

    // 检查是否在任务列表页 (ee / ue)
    if (comps.taskCardComp && Array.isArray(comps.taskCardComp.props.taskList)) {
      const list = comps.taskCardComp.props.taskList;
      // TaskStatus === 1 为进行中 (InProgress)
      const firstActive = list.find((item) => item.TaskStatus === 1) || list[0];
      if (firstActive) {
        emitToContent('LOG', {
          level: 'info',
          message: `📂 检测到待评课程《${firstActive.CourseName}》（教师：${firstActive.TeacherNames || '未知'}），正在进入问卷详情...`
        });
        comps.taskCardComp.cardClick(firstActive);
      }
    } else {
      // DOM 点击兜底：查找列表页的第一个课程卡片
      const cardEl = document.querySelector('[class*="TaskListFinal_item-"]');
      if (cardEl) {
        emitToContent('LOG', {
          level: 'info',
          message: '📂 检测到待评课程卡片，正在点击进入问卷详情...'
        });
        cardEl.click();
      }
    }

    // 等待问卷组件加载完成（最长等待 8 秒）
    for (let i = 0; i < 32; i++) {
      await sleep(250);
      comps = findReactComponents();
      if (
        comps.questionnaireComp &&
        comps.questionnaireComp.state &&
        comps.questionnaireComp.state.data &&
        Array.isArray(comps.questionnaireComp.state.data.Items) &&
        comps.questionnaireComp.state.data.Items.length > 0
      ) {
        await sleep(200);
        return { ok: true, comps };
      }
      if (document.querySelectorAll('[class*="index_subject-"]').length > 0) {
        await sleep(200);
        return { ok: true, comps: findReactComponents() };
      }
    }

    return { ok: false, comps };
  }

  /**
   * 执行【第一轮测试】：
   *   - 自动进入第一份待评问卷（若当前在列表页）
   *   - 自动填写所有理想化答案
   *   - 严格锁定不提交问卷
   *   - 返回完整的题目、候选项、已选理想答案核对表
   */
  async function runFirstRoundTest(options = {}) {
    try {
      emitToContent('STATUS_UPDATE', {
        status: 'testing',
        message: '正在执行第一轮测试（仅填写理想选项，绝不提交问卷）...'
      });

      const navResult = await ensureInsideQuestionnairePage();
      if (!navResult.ok) {
        emitToContent('TEST_ERROR', {
          message: '未能在当前页面找到待评问卷题目，请确认您已登录并处于“我的问卷/问卷详情”页面。'
        });
        return;
      }

      const report = await fillCurrentQuestionnaire({
        ...options,
        isTestMode: true
      });

      emitToContent('TEST_COMPLETE', {
        report
      });
    } catch (err) {
      emitToContent('TEST_ERROR', {
        message: `测试过程发生异常：${err && err.message ? err.message : String(err)}`
      });
    }
  }

  /**
   * 自动处理提交后的确认弹窗（如高分原因弹窗、分数确认弹窗、提交倒计时弹窗）
   */
  async function handleConfirmModals(qComp) {
    await sleep(350);

    // 1. 若触发了高/低分原因填写弹窗 (isShowEvaluateReasonModal)
    if (qComp && qComp.state && qComp.state.isShowEvaluateReasonModal) {
      const reasonText = '老师教学认真负责，严格遵守教学规定，课程内容很丰富，课堂气氛活跃，收获很大，非常满意！';
      qComp.setState({ evaluateReasonStr: reasonText });
      await sleep(150);
      if (typeof qComp.evaluateReasonModalConfirmHandler === 'function') {
        qComp.evaluateReasonModalConfirmHandler();
        await sleep(300);
      }
    }

    // 2. 检查 Ant Design Mobile 弹窗按钮（如“确 定”、“确定”、“我知道了”）
    const modalBtns = Array.from(
      document.querySelectorAll('.am-modal-button, .ant-modal-confirm-btns button, [class*="TaskMainContent_tips_btn-"]')
    );
    for (const btn of modalBtns) {
      const txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
      if (txt === '确定' || txt === '我知道了' || txt === '确认提交') {
        btn.click();
        await sleep(300);
      }
    }
  }

  /**
   * 执行【全自动完成所有教评任务】：
   *   循环填写当前问卷 -> 点击下一页/提交 -> 自动确认弹窗 -> 自动切换下一位教师/下一门课程
   */
  async function runAutoCompleteAllTasks(options = {}) {
    if (isAutoRunning) return;
    isAutoRunning = true;
    stopRequested = false;
    testModeSubmitBlocked = false;

    let completedCount = 0;

    try {
      emitToContent('STATUS_UPDATE', {
        status: 'running',
        message: '🚀 开始全自动完成所有教评任务...'
      });

      while (!stopRequested) {
        // 1. 先检查页面是否有“我知道了”提示弹窗并关闭
        await handleConfirmModals(null);

        // 2. 确保进入问卷作答页
        const navResult = await ensureInsideQuestionnairePage();
        if (!navResult.ok) {
          emitToContent('AUTO_COMPLETE_DONE', {
            completedCount,
            message: `🎉 所有待评课程任务已处理完毕！（本次共完成 ${completedCount} 份问卷）`
          });
          break;
        }

        const comps = findReactComponents();
        const qComp = comps.questionnaireComp;
        if (qComp) releaseTestModeGuard(qComp);

        // 如果当前问卷已经提交过 (answered)
        if (qComp && qComp.answered) {
          const moved = await moveToNextTeacherOrCourse();
          if (!moved) {
            emitToContent('AUTO_COMPLETE_DONE', {
              completedCount,
              message: `🎉 所有教评任务已全部完成！（共提交 ${completedCount} 份问卷）`
            });
            break;
          }
          await sleep(600);
          continue;
        }

        // 3. 自动填写当前页面所有题目
        const report = await fillCurrentQuestionnaire({
          ...options,
          isTestMode: false
        });

        const targetLabel = [report.courseName, report.teacherName].filter(Boolean).join(' - ') || report.questionnaireName;
        emitToContent('LOG', {
          level: 'info',
          message: `✍️ 已完成《${targetLabel}》全部 ${report.questions.length} 道题目的理想化选项填写，准备提交...`
        });

        await sleep(350);
        if (stopRequested) break;

        // 4. 点击“下一页”或“提交”按钮
        const submitBtn = document.querySelector('[class*="index_submit-"]');
        const btnText = submitBtn ? (submitBtn.innerText || submitBtn.textContent || '').trim() : '提交';

        if (qComp && typeof qComp.submit === 'function') {
          qComp.submit();
        } else if (submitBtn) {
          submitBtn.click();
        }

        // 若按钮是“下一页”（如课程题切换到教师题），等待切换后继续下一轮填写
        if (btnText.includes('下一页')) {
          emitToContent('LOG', {
            level: 'info',
            message: '➡️ 已完成本页（课程题），自动进入下一页（教师题）...'
          });
          await sleep(600);
          continue;
        }

        // 5. 处理可能出现的确认弹窗或高分理由弹窗
        await handleConfirmModals(qComp);
        await sleep(800);

        completedCount++;
        emitToContent('LOG', {
          level: 'success',
          message: `✅ 第 ${completedCount} 份问卷《${targetLabel}》提交成功！`
        });

        // 6. 自动跳转到下一位教师或下一门课程
        const hasNext = await moveToNextTeacherOrCourse();
        if (!hasNext) {
          emitToContent('AUTO_COMPLETE_DONE', {
            completedCount,
            message: `🎉 恭喜！所有教评任务已全部自动完成！（共提交 ${completedCount} 份问卷）`
          });
          break;
        }

        await sleep(800);
      }
    } catch (err) {
      emitToContent('TEST_ERROR', {
        message: `自动教评执行异常：${err && err.message ? err.message : String(err)}`
      });
    } finally {
      isAutoRunning = false;
    }
  }

  /**
   * 提交成功后，自动寻找并切换到“下一位教师”或“下一门课程”
   */
  async function moveToNextTeacherOrCourse() {
    await sleep(500);

    // 1. 检查是否弹出了“提交成功 -> 下一位教师 / 下一门课程”按钮
    const nextBtn = document.querySelector('[class*="TaskMainContent_next_btn-"]');
    if (nextBtn && nextBtn.offsetParent !== null) {
      const nextTxt = (nextBtn.innerText || nextBtn.textContent || '').trim();
      emitToContent('LOG', {
        level: 'info',
        message: `⏭️ 自动点击【${nextTxt || '下一份问卷'}】...`
      });
      nextBtn.click();
      await sleep(900);
      return true;
    }

    // 2. 检查 TaskMainContent (o9r0) 组件中是否还有未作答的教师或课程
    const comps = findReactComponents();
    const taskMain = comps.taskMainComp;
    if (taskMain) {
      if (typeof taskMain.findUnansweredTeacher === 'function') {
        const nextTeacher = taskMain.findUnansweredTeacher('next');
        if (nextTeacher) {
          const allList = (taskMain.state.currentCourse && taskMain.state.currentCourse.allList) || [];
          const idx = allList.indexOf(nextTeacher);
          taskMain.onChangeTeacher(nextTeacher, idx >= 0 ? idx : 0);
          await sleep(700);
          return true;
        }
      }
      if (typeof taskMain.findUnansweredCourse === 'function') {
        const nextCourse = taskMain.findUnansweredCourse('next');
        if (nextCourse) {
          const courseList = (taskMain.props.task && taskMain.props.task.CourseList) || [];
          const idx = courseList.indexOf(nextCourse);
          taskMain.onChangeCourse(nextCourse, idx >= 0 ? idx : 0);
          await sleep(700);
          return true;
        }
      }
      if (typeof taskMain.getLastCourse === 'function') {
        const nextTaskCourse = taskMain.getLastCourse();
        if (nextTaskCourse && typeof taskMain.jumpNextNoAnswerCourse === 'function') {
          taskMain.jumpNextNoAnswerCourse();
          await sleep(1000);
          return true;
        }
      }
    }

    // 3. 若当前在单门课程答题页 (#/my-task/answer-Final-evaluate)，返回课程列表页检查是否还有未完成课程
    if (window.location.hash.includes('/my-task/answer-')) {
      window.history.back();
      await sleep(1200);
      const afterBackComps = findReactComponents();
      if (afterBackComps.taskCardComp && Array.isArray(afterBackComps.taskCardComp.props.taskList)) {
        const remaining = afterBackComps.taskCardComp.props.taskList.filter((t) => t.TaskStatus === 1);
        if (remaining.length > 0) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 监听来自 Content Script 的指令
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'MYCOS_EVAL_CONTENT_SCRIPT') {
      return;
    }

    const { action, options } = event.data;
    if (action === 'RUN_TEST_ROUND') {
      runFirstRoundTest(options || {});
    } else if (action === 'RUN_AUTO_ALL') {
      runAutoCompleteAllTasks(options || {});
    } else if (action === 'STOP_AUTO') {
      stopRequested = true;
      isAutoRunning = false;
      emitToContent('STATUS_UPDATE', {
        status: 'stopped',
        message: '⏹️ 已停止自动教评任务。'
      });
    } else if (action === 'PING_STATUS') {
      const comps = findReactComponents();
      const hasQn = !!(comps.questionnaireComp && comps.questionnaireComp.state && comps.questionnaireComp.state.data && comps.questionnaireComp.state.data.Items);
      const hasList = !!(comps.taskCardComp && Array.isArray(comps.taskCardComp.props.taskList));
      emitToContent('PAGE_STATUS', {
        hasQuestionnaire: hasQn,
        hasTaskList: hasList,
        isAutoRunning,
        url: window.location.href
      });
    }
  });

  emitToContent('AGENT_READY', { url: window.location.href });
})();
