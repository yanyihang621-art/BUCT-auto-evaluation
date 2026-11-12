/**
 * 麦可思教学质量管理平台 (mycospxk.com) 理想化答案智能决策引擎
 * 支持题型：
 *   0 - FeedBack (意见反馈题/主观题)
 *   1 - SingleSelect (单选题)
 *   2 - MultiSelect (多选题)
 *   3 - FillBlank (填空题)
 *   4 - UEdito (问答题/主观题)
 *   5 - MatrixScore (矩阵量表/星级打分题)
 *   6 - MatrixSingle (矩阵单选题)
 *   7 - MarkScore (评价打分/滑块题)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MycosIdealEvaluator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUBJECT_TYPES = {
    FeedBack: 0,
    SingleSelect: 1,
    MultiSelect: 2,
    FillBlank: 3,
    UEdito: 4,
    MatrixScore: 5,
    MatrixSingle: 6,
    MarkScore: 7,
    FileUpload: 8,
    Text: 9
  };

  const SUBJECT_TYPE_NAMES = {
    0: '意见反馈题',
    1: '单选题',
    2: '多选题',
    3: '填空题',
    4: '问答题',
    5: '矩阵打分题',
    6: '矩阵单选题',
    7: '滑块打分题',
    8: '文件上传题',
    9: '文本说明'
  };

  /**
   * 清理 HTML 标签与多余空白
   */
  function stripHtml(html) {
    if (!html) return '';
    return String(html)
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 分析题干语义类型（Polarity & Category）
   * 返回：
   *   - 'negative_check': 负面行为/违规违纪/师德失范/缺点问题排查题（理想答案应为“没有违反规定/无/从不/不存在/以上均无”）
   *   - 'moderation': 难度/作业量/进度/语速适中度题（理想答案应为“非常合理/适中/恰当/正好”）
   *   - 'shortcoming_text': 询问不足/缺点/改进建议的主观题（理想答案应为“无不足，课程很丰富，老师非常认真负责，非常满意”）
   *   - 'positive': 正向评价题（满意度、课程丰富度、教学态度、收获、互动等，理想答案应为“非常满意/完全同意/课程很丰富/总是”等最高正向项）
   */
  function analyzeQuestionContext(rawTitle) {
    const title = stripHtml(rawTitle);

    // 1. 判断题干是否为正向陈述但包含“不迟到/无违规/遵守规定”等字眼
    // 例如：“教师严格遵守教学规定，做到了不迟到、不早退、不随意调停课” -> 属于正向陈述，应选“非常符合/完全同意”
    const positiveNegatedPatterns = [
      /做到(了)?不(迟到|早退|旷课|拖堂|随意|违规|违反|照本宣科)/,
      /(严格|模范|能够|自觉)遵守/,
      /无(违规|违反|不良|不当|迟到|早退).*行为.*(符合|同意|满意)/,
      /言行雅正|为人师表|治学严谨|关爱学生|教风端正|备课充分/
    ];
    const isPositiveDisciplineStatement = positiveNegatedPatterns.some((re) => re.test(title));

    // 2. 判断题干是否为“是否存在违规/违纪/迟到/不当言行/不足/问题”等负面排查问法
    const negativeInquiryPatterns = [
      /(是否|有无|有没有|存在|出现|发生|发现).*(违反|违规|违纪|不当|不良|失范|不端|错误言论|负面|迟到|早退|旷课|拖堂|私自|随意调|随意停|代课|推销|微商|歧视|侮辱|体罚|讽刺|挖苦|敷衍|照本宣科|念PPT|念课件|满堂灌|乱收费|收受|索要)/,
      /(违反|违规|违纪|师德失范|教学事故|不当言行|不良行为|迟到早退|随意调停课)/,
      /(存在|有哪些|有何|什么).*(问题|不足|缺点|弊端|困难|障碍|欠缺|不合理|不满意)/,
      /(问题|不足|缺点|弊端|困难|不良现象).*(是|有|包括|表现在)/,
      /是否有.*(听不懂|跟不上|脱节|枯燥|乏味|水课|负担过重)/
    ];

    if (!isPositiveDisciplineStatement && negativeInquiryPatterns.some((re) => re.test(title))) {
      // 如果题干虽然含“遵守教学规定”，但问法是“是否有违反规定”，归为 negative_check
      return {
        category: 'negative_check',
        title
      };
    }

    // 3. 判断是否为主观题询问“不足/缺点/改进建议/意见”
    if (/(不足|缺点|欠缺|有待改进|需要改进|改进建议|意见或建议|意见和建议|存在的问题)/.test(title)) {
      return {
        category: 'shortcoming_text',
        title
      };
    }

    // 4. 判断是否为“作业量/课业负担/课程难度/授课进度/讲课速度”适中度题
    if (/(作业量|题量|负担|难度|难易|深浅|进度|快慢|语速|节奏)/.test(title) && !/(丰富|满意|清晰|认真)/.test(title)) {
      return {
        category: 'moderation',
        title
      };
    }

    return {
      category: 'positive',
      title
    };
  }

  /**
   * 评估单个选项在给定题干上下文中的“理想化得分”（分值越高越理想）
   */
  function scoreOption(option, optionIndex, totalOptions, questionCtx, isSetScore) {
    const text = stripHtml(option.Title || option.Name || option.text || '');
    const cleanText = text.replace(/^[A-Z0-9a-z][\s.、．:：)-]+/, '').trim();
    let score = 0;
    const reasons = [];

    // 0. 排除项或“其他（请注明）”轻微降权（除非是负面排查题中的“以上均无”）
    if (option.IsSetOptions && /(其他|其它|请注明|请填写|具体说明)/.test(cleanText)) {
      score -= 35;
      reasons.push('需额外填空的“其他”项降权');
    }

    // =========================================================
    // 第一部分：选项自身具备明确的正/负语义（自包含语义优先）
    // =========================================================

    // 1A. 明确表示“无违规/遵守规定/无问题”的理想选项（无论题干怎么问，这类自包含表述都是正面理想项）
    const explicitNoViolationPatterns = [
      /没有违反|无违反|未违反|从不违反|绝不违反/,
      /没有违规|无违规|未违规|从不违规|不存在违规|未发现违规/,
      /严格遵守|模范遵守|完全遵守|遵守.*规定|遵守.*纪律/,
      /无不良|没有不良|无不当|没有不当|无师德问题|没有师德问题/,
      /从不迟到|没有迟到|无迟到|按时上下课|准时上下课/,
      /以上均无|均无|无上述(问题|情况|现象|行为)|没有上述(问题|情况|现象|行为)|无以上(问题|情况|现象)|都不存在|未出现过|从未出现|无此现象|没有任何问题|没有问题|无问题/
    ];
    if (explicitNoViolationPatterns.some((re) => re.test(cleanText))) {
      score += 130;
      reasons.push('明确符合“没有违反规定/无不良现象”理想项');
    }

    // 1B. 明确表示“存在违规/迟到/不良行为/缺点”的负面自包含选项（在任何题型下都绝不选！）
    const explicitViolationOrBadPatterns = [
      /(存在|有|偶有|偶尔|经常|多次|严重).*(违反|违规|违纪|不当|不良|失范|迟到|早退|旷课|拖堂|调课|停课|代课|照本宣科|敷衍|体罚|侮辱|歧视|推销)/,
      /违反规定|违规调|迟到早退|随意调停|照本宣科|念PPT|念课件|敷衍了事|态度恶劣|不负责任|不备课|内容陈旧|枯燥乏味|毫无收获|完全听不懂|脱离教材|错误言论/
    ];
    // 注意避免误伤“没有违反规定”、“从不迟到早退”、“无照本宣科”
    const hasNegationPrefix = /^(没有|无|未|从不|从未|不存在|绝不|不|0|零)/.test(cleanText) ||
      /(没有|无|未|从不|从未|不存在)(出现|发生|发现|存在)?(违反|违规|违纪|不当|不良|迟到|早退|拖堂|随意调|照本宣科)/.test(cleanText);

    if (!hasNegationPrefix && explicitViolationOrBadPatterns.some((re) => re.test(cleanText))) {
      score -= 150;
      reasons.push('排除负面/违规描述项');
    }

    // 1C. 最高等级正向词汇（非常满意、完全同意、课程很丰富、极好等）
    const topPositivePatterns = [
      /^(非常|十分|极其|极为|完全|特别|高度|极)(满意|同意|符合|赞同|认可|好|优秀|丰富|充实|清晰|合理|及时|认真|充分|到位|规范|敬业|融洽|活跃|喜欢|愿意|推荐|有帮助|大|高|强)/,
      /(内容|课程|资源|案例|拓展).*(非常丰富|很丰富|极为丰富|十分丰富|丰富多彩|充实丰富|非常充实)/,
      /(非常|十分|很|极其)(丰富|充实|饱满|生动|透彻|清晰|严谨|负责|满意|出色|优秀)/,
      /^(很|非常)(满意|好|丰富|充实|清晰|合理|及时|认真|充分|有帮助|大|高|强|喜欢|愿意)$/,
      /收获(很大|非常大|极大|颇丰|满满)|帮助(很大|非常大|极大)/,
      /完全掌握|全部掌握|熟练掌握|深入理解|完全听懂/,
      /100%|95%以上|90%以上|全部完成|每次都|总是|始终如一/,
      /^优$|^优秀$|^A$|^A\+|^A级|^A等|^第一档|^满分/
    ];
    if (topPositivePatterns.some((re) => re.test(cleanText))) {
      score += 120;
      reasons.push('最高等级正向理想项（非常满意/很丰富/完全符合等）');
    }

    // 1D. 次高等级正向词汇（比较满意、满意、较好、丰富等）
    const secondPositivePatterns = [
      /^(比较|较为|较|基本|还算)(满意|同意|符合|赞同|认可|好|丰富|充实|清晰|合理|及时|认真|充分|有帮助|大|高|强|喜欢|愿意)/,
      /^(满意|同意|符合|赞同|认可|良好|良|好|丰富|充实|清晰|合理|及时|认真|充分|有帮助|推荐|愿意|喜欢)$/,
      /^B$|^B级|^B等|较好|良好|有一定收获|收获较大|基本掌握|大部分掌握|经常/
    ];
    if (secondPositivePatterns.some((re) => re.test(cleanText)) && score < 100) {
      score += 75;
      reasons.push('正向良好项');
    }

    // 1E. 中性/一般词汇
    const neutralPatterns = [
      /^(一般|普通|中等|中|合格|C|C级|尚可|还行|平平|说不清|不确定|不了解|无所谓|看情况)$/
    ];
    if (neutralPatterns.some((re) => re.test(cleanText))) {
      score += 20;
      reasons.push('中性一般项');
    }

    // 1F. 明确负面等级词汇（不满意、不同意、较差、很差、枯燥等）
    const negativeLevelPatterns = [
      /^(不太|不|很不|非常不|完全不|极不|毫无)(满意|同意|符合|赞同|认可|好|丰富|充实|清晰|合理|及时|认真|充分|有帮助|喜欢|愿意|推荐)/,
      /^(较差|差|很差|极差|不合格|不及格|D|E|F|糟糕|匮乏|单一|枯燥|生硬|模糊|混乱|滞后|敷衍|很少|极少|毫无收获|没有收获|听不懂)$/
    ];
    if (negativeLevelPatterns.some((re) => re.test(cleanText))) {
      score -= 120;
      reasons.push('排除不满意/差评项');
    }

    // =========================================================
    // 第二部分：结合题干类型的上下文极性判断
    // =========================================================
    if (questionCtx.category === 'negative_check') {
      // 负面/违规排查题：如“教师是否有违反规定的行为？”、“是否存在迟到早退？”
      if (/^(没有|无|否|从不|从未|不存在|未发现|未出现|0次|0|零|完全没有|绝无)$/.test(cleanText) ||
          /(没有|无|从不|从未|不存在|未发现).*(违反|违规|迟到|早退|拖堂|调停课|不良|不当|问题|现象|情况|行为)/.test(cleanText)) {
        score += 140;
        reasons.push('违规/负面排查题中选择“没有/无/从不”');
      } else if (/^(偶尔|偶有|极少|少数|1-2次|1次|有时|略微)/.test(cleanText)) {
        score -= 60;
        reasons.push('违规/负面排查题中排除“偶尔”');
      } else if (/^(有|是|存在|经常|总是|多次|很多|普遍)/.test(cleanText)) {
        score -= 140;
        reasons.push('违规/负面排查题中排除“有/存在/经常”');
      }
    } else if (questionCtx.category === 'moderation') {
      // 难度/作业量/进度适中题
      if (/(非常合理|完全适中|非常适中|恰到好处|非常恰当|非常合适)/.test(cleanText)) {
        score += 125;
        reasons.push('难度/负荷题最高理想项（非常合理/完全适中）');
      } else if (/^(适中|合适|合理|恰当|正好|刚刚好|难易适中|进度适中|题量适中|分量适中)$/.test(cleanText)) {
        score += 110;
        reasons.push('难度/负荷题理想项（适中/合理）');
      } else if (/(偏难|太难|过难|偏易|太易|过易|太简单|偏多|太多|过多|过重|偏少|太少|过少|过轻|太快|偏快|过快|太慢|偏慢|过慢)/.test(cleanText)) {
        score -= 70;
        reasons.push('排除过高/过低偏离项');
      }
    } else {
      // 正向题干：如“教师是否按时上下课？”、“课程内容是否丰富？”
      if (/^(是|有|总是|每次|经常|完全做到|全部做到|非常丰富|很丰富|丰富)$/.test(cleanText)) {
        score += 105;
        reasons.push('正向题干肯定回答');
      } else if (/^(否|没有|无|从不|从未|不丰富|很少)$/.test(cleanText)) {
        score -= 110;
        reasons.push('正向题干排除否定回答');
      }
    }

    // =========================================================
    // 第三部分：结合平台自带 BandScore（选项分值）与位置权重
    // =========================================================
    const bandScore = Number(option.BandScore);
    if (!Number.isNaN(bandScore) && bandScore > 0) {
      // 平台配置的选项分值（如 10, 8, 6, 4 或 5, 4, 3, 2, 1）
      score += bandScore * 5;
      reasons.push(`选项分值(${bandScore}分)`);
    }

    // 若所有选项没有文本匹配差异，在麦可思问卷中第1个选项(index=0)通常为最高档（如 A.非常满意）
    const positionBonus = (totalOptions - optionIndex) * 0.5;
    score += positionBonus;

    return {
      optionId: option.Id,
      optionIndex,
      text: cleanText || text || `选项${optionIndex + 1}`,
      rawTitle: option.Title,
      bandScore: Number.isNaN(bandScore) ? 0 : bandScore,
      isExclusive: !!option.IsExclusive,
      isSetOptions: !!option.IsSetOptions,
      isHide: !!option.IsHide,
      score: Number(score.toFixed(2)),
      reasons
    };
  }

  /**
   * 为主观题（问答题 UEdito / 意见反馈题 FeedBack / 填空题 FillBlank）生成理想化回答
   */
  function generateIdealTextAnswer(item, questionCtx, customComment) {
    const minLen = (item && item.Props && item.Props.CustomAttr && item.Props.CustomAttr.DataOptions && item.Props.CustomAttr.DataOptions.MinTextNumber) || 0;

    let baseText = '';
    if (customComment && customComment.trim()) {
      baseText = customComment.trim();
    } else if (questionCtx.category === 'shortcoming_text') {
      baseText = '无。任课教师严格遵守教学规定，没有任何违规行为；教学态度非常认真，课程内容很丰富、重点突出，课堂互动良好，对本门课程非常满意！';
    } else {
      baseText = '老师治学严谨，严格遵守教学规定，无任何违规现象；备课十分充分，课程内容很丰富，讲解深入浅出、条理清晰，课堂收获很大，非常满意！';
    }

    // 若题目要求最小字数超过当前文本长度，自动扩充理想化好评内容
    const paddingSentences = [
      '同时老师非常注重理论联系实际，案例生动详实，极大激发了我们的学习兴趣与思考能力。',
      '课后答疑与作业批改也非常及时认真，是一门质量极高、令人受益匪浅的优质课程！'
    ];
    let idx = 0;
    while (baseText.length < minLen && idx < paddingSentences.length) {
      baseText += paddingSentences[idx++];
    }
    while (baseText.length < minLen) {
      baseText += '非常满意，感谢老师的悉心教导！';
    }

    return baseText;
  }

  /**
   * 针对单个题目 (Item) 计算理想化答案
   * @param {Object} item 麦可思问卷题目对象
   * @param {Object} options 配置项 { preferSecondBest?: boolean, customComment?: string }
   */
  function evaluateQuestionItem(item, options = {}) {
    const subjectType = item.SubjectType;
    const typeName = SUBJECT_TYPE_NAMES[subjectType] || `未知题型(${subjectType})`;
    const customAttr = (item.Props && item.Props.CustomAttr) || {};
    const questionCtx = analyzeQuestionContext(item.Title);

    // 判定是否必答：
    // 在麦可思系统中，Props.CustomAttr.IsAllowNull === true 明确表示允许为空（非必答）。
    // 若 IsAllowNull === false 则为必答。
    let isRequired = customAttr.IsAllowNull === false;
    if (customAttr.IsAllowNull === true) {
      isRequired = false;
    } else if (customAttr.IsAllowNull === undefined) {
      // 未显式指定 IsAllowNull 时：客观题通常默认为必答，主观反馈题默认为选答
      if (subjectType === SUBJECT_TYPES.FeedBack || subjectType === SUBJECT_TYPES.UEdito) {
        isRequired = false;
      }
    }

    // 针对“对课程和任课教师的建议/意见”类问题：
    // 用户特别指出：“针对我对课程和老师的建议这个问题，由于不是必答问题直接不填写，其他非必答问题也不填写”
    const isSuggestionQuestion = /(对.*(课程|任课|授课)?(教师|老师|教学).*(意见|建议)|意见(或|和)?建议|改进(意见|建议)|您的建议|还有哪些(话|想说|建议)|课程建议|教师建议)/.test(questionCtx.title);
    if (isSuggestionQuestion) {
      const hasStrictMin = customAttr.DataOptions && Number(customAttr.DataOptions.MinTextNumber) > 0;
      if (customAttr.IsAllowNull !== false || !hasStrictMin) {
        isRequired = false;
      }
    }

    const isSetScore = !!customAttr.IsSetScore;

    const result = {
      subjectId: item.Id,
      sortNumber: item.SortNumber,
      title: questionCtx.title,
      questionCategory: questionCtx.category,
      subjectType,
      typeName,
      isRequired,
      isTeacher: item.IsTeacher,
      maxScore: item.Score || 0,
      allOptions: [],
      selectedOptionIds: [],
      selectedOptionTexts: [],
      formFields: {},
      extraFillFields: {},
      summaryText: '',
      reason: ''
    };

    // 【核心策略】：如果是非必答问题（包括“对课程和老师的建议”等选答题），按要求直接不填写（留空/不选）
    if (!isRequired) {
      result.isRequired = false;
      result.selectedOptionIds = [];
      result.selectedOptionTexts = [];
      result.formFields = {};
      result.extraFillFields = {};
      result.summaryText = '（非必答题，直接不填写）';
      result.reason = isSuggestionQuestion
        ? '对课程/教师的建议非必答，按要求直接不填写'
        : '非必答问题，按要求直接不填写';
      return result;
    }

    // 1. 单选题 (SingleSelect = 1)
    if (subjectType === SUBJECT_TYPES.SingleSelect) {
      const rawOptions = ((item.Props && item.Props.Items && item.Props.Items.Options) || []).filter((o) => !o.IsHide);
      const scored = rawOptions.map((opt, idx) => scoreOption(opt, idx, rawOptions.length, questionCtx, isSetScore));

      // 如果题目启用了计分 (IsSetScore) 且不同选项有明确的 BandScore 梯度，同时最高 BandScore 项不违背负面语义
      const maxBand = Math.max(...scored.map((s) => s.bandScore));
      const minBand = Math.min(...scored.map((s) => s.bandScore));
      if (isSetScore && maxBand > minBand) {
        scored.forEach((s) => {
          if (s.bandScore === maxBand) {
            s.score += 100;
            s.reasons.unshift(`官方最高分值项(${s.bandScore}分)`);
          }
        });
      }

      const sorted = [...scored].sort((a, b) => b.score - a.score);
      // 仅当外部显式要求在特定题目防满分/防雷同时选次优项，否则一律选第1理想项
      const chosen = (options.preferSecondBest && sorted.length > 1) ? sorted[1] : sorted[0];

      result.allOptions = scored.map((s) => ({
        id: s.optionId,
        index: s.optionIndex,
        text: s.text,
        bandScore: s.bandScore,
        evalScore: s.score
      }));

      if (chosen) {
        result.selectedOptionIds = [chosen.optionId];
        result.selectedOptionTexts = [chosen.text];
        result.formFields[String(item.Id)] = chosen.optionId;
        if (chosen.isSetOptions) {
          const fillKey = `${item.Id}_${chosen.optionId}`;
          result.formFields[fillKey] = '非常满意';
          result.extraFillFields[fillKey] = '非常满意';
        }
        result.summaryText = chosen.text;
        result.reason = chosen.reasons.join('；') || '最优理想选项';
      }
      return result;
    }

    // 2. 多选题 (MultiSelect = 2)
    if (subjectType === SUBJECT_TYPES.MultiSelect) {
      const rawOptions = ((item.Props && item.Props.Items && item.Props.Items.Options) || []).filter((o) => !o.IsHide);
      const dataOpts = customAttr.DataOptions || {};
      const minNum = Number(dataOpts.MinAnswerNumber) || 1;
      const maxNum = Number(dataOpts.MaxAnswerNumber) || rawOptions.length;

      const scored = rawOptions.map((opt, idx) => scoreOption(opt, idx, rawOptions.length, questionCtx, isSetScore));
      result.allOptions = scored.map((s) => ({
        id: s.optionId,
        index: s.optionIndex,
        text: s.text,
        bandScore: s.bandScore,
        isExclusive: s.isExclusive,
        evalScore: s.score
      }));

      if (questionCtx.category === 'negative_check') {
        // 负面排查多选题：优先寻找排他项或“以上均无/无上述问题/没有违反规定”
        const noneOpt = scored.find((s) =>
          s.isExclusive ||
          /以上均无|均无|无上述|没有上述|无以上|没有问题|无问题|都不存在|没有违反|无违反|无违规|^无$|^没有$/.test(s.text)
        );
        const chosenList = noneOpt ? [noneOpt] : [scored.sort((a, b) => b.score - a.score)[0]].filter(Boolean);
        result.selectedOptionIds = chosenList.map((c) => c.optionId);
        result.selectedOptionTexts = chosenList.map((c) => c.text);
        result.formFields[String(item.Id)] = result.selectedOptionIds;
        result.summaryText = result.selectedOptionTexts.join('、');
        result.reason = noneOpt ? '负面排查多选题仅勾选排他理想项（无问题/无违规）' : '负面多选题最优项';
      } else {
        // 正向多选题：选择所有正向且非排他的优质选项（且尽量不触发“其他（请注明）”填空），数量控制在 [minNum, maxNum]
        let positiveCandidates = scored
          .filter((s) => !s.isExclusive && s.score > 0 && !s.isSetOptions)
          .sort((a, b) => b.score - a.score);

        if (positiveCandidates.length < minNum) {
          positiveCandidates = scored
            .filter((s) => !s.isExclusive)
            .sort((a, b) => b.score - a.score);
        }

        // 若存在按勾选个数计分规则 (OptionsCountRules)，优先挑选得分最高的个数
        let targetCount = Math.min(positiveCandidates.length, maxNum);
        const countRules = item.Props && item.Props.Items && item.Props.Items.OptionsCountRules;
        if (Array.isArray(countRules) && countRules.length > 0) {
          const bestRule = [...countRules].sort((a, b) => (b.BandScore || 0) - (a.BandScore || 0))[0];
          if (bestRule && bestRule.OptionsCount >= minNum && bestRule.OptionsCount <= maxNum) {
            targetCount = Math.min(positiveCandidates.length, bestRule.OptionsCount);
          }
        }
        targetCount = Math.max(minNum, Math.min(targetCount, maxNum, positiveCandidates.length));

        const chosenList = positiveCandidates.slice(0, targetCount);
        result.selectedOptionIds = chosenList.map((c) => c.optionId);
        result.selectedOptionTexts = chosenList.map((c) => c.text);
        result.formFields[String(item.Id)] = result.selectedOptionIds;
        chosenList.forEach((c) => {
          if (c.isSetOptions) {
            const fillKey = `${item.Id}_${c.optionId}`;
            result.formFields[fillKey] = '非常满意';
            result.extraFillFields[fillKey] = '非常满意';
          }
        });
        result.summaryText = result.selectedOptionTexts.join('、');
        result.reason = `正向多选题全选最优理想项（共${chosenList.length}项）`;
      }
      return result;
    }

    // 3. 滑块/数字打分题 (MarkScore = 7)
    if (subjectType === SUBJECT_TYPES.MarkScore) {
      const dataOpts = customAttr.DataOptions || {};
      const maxVal = dataOpts.MaxValue !== undefined ? Number(dataOpts.MaxValue) : 100;
      const minVal = dataOpts.MinValue !== undefined ? Number(dataOpts.MinValue) : 0;
      const idealScore = options.preferSecondBest && maxVal > minVal + 1 ? maxVal - 1 : maxVal;

      result.allOptions = [{ id: 'range', text: `分值范围 [${minVal} ~ ${maxVal}]`, bandScore: maxVal }];
      result.selectedOptionIds = [idealScore];
      result.selectedOptionTexts = [`${idealScore}分 (满分${maxVal}分)`];
      result.formFields[String(item.Id)] = idealScore;

      // 如果打分题开启了高分原因必填 (HighLowSetting)
      const firstOptId = item.Props && item.Props.Items && item.Props.Items.Options && item.Props.Items.Options[0] && item.Props.Items.Options[0].Id;
      if (firstOptId !== undefined) {
        const reasonKey = `${item.Id}_${firstOptId}`;
        result.extraFillFields[reasonKey] = '老师备课充分，遵守教学规定，课程内容很丰富，非常满意！';
      }

      result.summaryText = `${idealScore}分`;
      result.reason = `打分题给予最高理想分值 (${idealScore}/${maxVal})`;
      return result;
    }

    // 4. 矩阵单选题 (MatrixSingle = 6)
    if (subjectType === SUBJECT_TYPES.MatrixSingle) {
      const issues = (item.Props && item.Props.Items && item.Props.Items.Issues) || [];
      const rawOptions = ((item.Props && item.Props.Items && item.Props.Items.Options) || []).filter((o) => !o.IsHide);
      const subSummaries = [];

      result.allOptions = rawOptions.map((o, idx) => ({
        id: o.Id,
        index: idx,
        text: stripHtml(o.Title),
        bandScore: o.BandScore
      }));

      issues.forEach((issue) => {
        const issueCtx = analyzeQuestionContext(issue.Title || item.Title);
        const scored = rawOptions.map((opt, idx) => scoreOption(opt, idx, rawOptions.length, issueCtx, isSetScore));
        const sorted = [...scored].sort((a, b) => b.score - a.score);
        const chosen = sorted[0];
        if (chosen) {
          const fieldKey = `${item.Id}.${issue.Id}`;
          result.formFields[fieldKey] = chosen.optionId;
          subSummaries.push(`${stripHtml(issue.Title)} → ${chosen.text}`);
        }
      });

      result.selectedOptionTexts = subSummaries;
      result.summaryText = subSummaries.join('；');
      result.reason = '矩阵单选各子项均匹配最优理想项';
      return result;
    }

    // 5. 矩阵量表/星级打分题 (MatrixScore = 5)
    if (subjectType === SUBJECT_TYPES.MatrixScore) {
      const issues = (item.Props && item.Props.Items && item.Props.Items.Issues) || [];
      const rawOptions = (item.Props && item.Props.Items && item.Props.Items.Options) || [];
      const maxStar = (customAttr.DataOptions && Number(customAttr.DataOptions.Star)) || 5;
      const subSummaries = [];

      result.allOptions = [{ id: 'star', text: `最高 ${maxStar} 星` }];

      issues.forEach((issue) => {
        rawOptions.forEach((opt) => {
          const fieldKey = `${item.Id}.${issue.Id}.${opt.Id}`;
          result.formFields[fieldKey] = maxStar;
          subSummaries.push(`${stripHtml(issue.Title)}(${stripHtml(opt.Title)}) → ${maxStar}星`);
        });
      });

      result.selectedOptionTexts = subSummaries;
      result.summaryText = `全部 ${maxStar} 星（满星）`;
      result.reason = `矩阵星级题给予满星 (${maxStar}星)`;
      return result;
    }

    // 6. 填空题 (FillBlank = 3)
    if (subjectType === SUBJECT_TYPES.FillBlank) {
      const rawOptions = (item.Props && item.Props.Items && item.Props.Items.Options) || [];
      const textAnswer = generateIdealTextAnswer(item, questionCtx, options.customComment);
      const subSummaries = [];

      rawOptions.forEach((opt, idx) => {
        const fieldKey = `${item.Id}.${opt.Id}`;
        const val = rawOptions.length === 1 ? textAnswer : `非常满意，课程内容很丰富（第${idx + 1}空）`;
        result.formFields[fieldKey] = val;
        subSummaries.push(val);
      });

      result.allOptions = [{ id: 'blank', text: `填空项(${rawOptions.length}个)` }];
      result.selectedOptionTexts = subSummaries;
      result.summaryText = subSummaries.join('；');
      result.reason = '填空题自动填入理想化正向评价';
      return result;
    }

    // 7. 问答题 (UEdito = 4) 与 意见反馈题 (FeedBack = 0)
    if (subjectType === SUBJECT_TYPES.UEdito || subjectType === SUBJECT_TYPES.FeedBack) {
      const textAnswer = generateIdealTextAnswer(item, questionCtx, options.customComment);
      result.allOptions = [{ id: 'textarea', text: isRequired ? '主观必答题' : '主观选答题（自动填写好评）' }];
      result.selectedOptionTexts = [textAnswer];
      result.formFields[String(item.Id)] = textAnswer;
      result.summaryText = textAnswer;
      result.reason = questionCtx.category === 'shortcoming_text'
        ? '针对“不足/建议”类主观题填入“无违规、课程很丰富、非常满意”'
        : '主观题填入理想化满分好评';
      return result;
    }

    // 其他说明类或无需作答题型
    result.summaryText = '无需作答';
    result.reason = '段落说明或附件题';
    return result;
  }

  /**
   * 评估整张问卷的数据对象 (state.data)
   * @param {Object} questionnaireData 麦可思 gC6G 组件的 state.data
   * @param {Object} options { avoidFullMarkIfForbidden?: boolean, customComment?: string, logicsHides?: Set|Array }
   */
  function evaluateQuestionnaire(questionnaireData, options = {}) {
    if (!questionnaireData || !Array.isArray(questionnaireData.Items)) {
      return {
        questionnaireName: '',
        isFullMarkAllowed: true,
        isSameIndexAllowed: true,
        questions: [],
        mergedFormFields: {}
      };
    }

    const isScore = Number(questionnaireData.IsScore) === 1;
    const isFullMarkAllowed = !(isScore && questionnaireData.IsFullMark === false);
    const isSameIndexAllowed = questionnaireData.IsChoosableSameIndex !== false;
    const hiddenSet = new Set(
      options.logicsHides instanceof Set
        ? Array.from(options.logicsHides)
        : Array.isArray(options.logicsHides)
        ? options.logicsHides
        : []
    );

    const visibleItems = questionnaireData.Items.filter((item) => !hiddenSet.has(item.Id));
    const singleSelectItems = visibleItems.filter((item) => item.SubjectType === SUBJECT_TYPES.SingleSelect);

    // 默认100%全部选最理想选项；仅当用户开启 avoidFullMarkIfForbidden 且学校确实禁止满分/全同选项时微调最后1道单选题
    const needAdjustLastSingle =
      !!options.avoidFullMarkIfForbidden &&
      (!isFullMarkAllowed || !isSameIndexAllowed) &&
      singleSelectItems.length >= 2;

    const lastSingleId = needAdjustLastSingle ? singleSelectItems[singleSelectItems.length - 1].Id : null;

    const evaluatedQuestions = [];
    const mergedFormFields = {};

    visibleItems.forEach((item, index) => {
      if (item.SubjectType === SUBJECT_TYPES.Text) return;
      const itemEval = evaluateQuestionItem(item, {
        preferSecondBest: item.Id === lastSingleId,
        customComment: options.customComment
      });
      itemEval.questionNumber = index + 1;
      evaluatedQuestions.push(itemEval);
      Object.assign(mergedFormFields, itemEval.formFields);
    });

    return {
      questionnaireId: questionnaireData.Id,
      questionnaireName: stripHtml(questionnaireData.Name || '教学质量管理平台评价问卷'),
      typeCode: questionnaireData.TypeCode || questionnaireData.Type || '',
      isScore,
      isFullMarkAllowed,
      isSameIndexAllowed,
      questions: evaluatedQuestions,
      mergedFormFields
    };
  }

  return {
    SUBJECT_TYPES,
    SUBJECT_TYPE_NAMES,
    stripHtml,
    analyzeQuestionContext,
    scoreOption,
    generateIdealTextAnswer,
    evaluateQuestionItem,
    evaluateQuestionnaire
  };
});
