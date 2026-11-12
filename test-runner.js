/**
 * 麦可思教学质量管理平台 (mycospxk.com) 第一轮测试验证脚本（测试模式：不提交问卷）
 * 模拟平台真实问卷数据结构 (type=5, typeCode=Middle 期中学生教学质量评价)
 * 验证：
 *   1. 必答题全部命中最高理想项（非常满意、没有违反规定、课程很丰富、难易适中、满分打分等）
 *   2. 非必答问题（如“对课程和任课教师的意见或建议”、非必答单选等）直接不填写！
 */
const assert = require('assert');
const Evaluator = require('./evaluator.js');

const mockMiddleQuestionnaireData = {
  Id: 1001,
  Name: '2026-2027学年第一学期期中学生教学质量评价问卷 (Middle)',
  TypeCode: 'Middle',
  Type: 5,
  IsScore: 1,
  IsFullMark: true,
  IsChoosableSameIndex: true,
  Items: [
    {
      Id: 101,
      SortNumber: 0,
      SubjectType: 1, // 单选题
      Title: '1. 任课教师在授课过程中是否存在违反师德师风或违反教学管理规定（如随意调停课、迟到早退、不当言论等）的行为？',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: false },
        Items: {
          Options: [
            { Id: 1011, Title: 'A. 经常存在违反规定的行为', BandScore: 0 },
            { Id: 1012, Title: 'B. 偶尔存在违反规定的行为', BandScore: 0 },
            { Id: 1013, Title: 'C. 没有违反规定，严格遵守教学规范', BandScore: 10 }
          ]
        }
      }
    },
    {
      Id: 102,
      SortNumber: 1,
      SubjectType: 1, // 单选题
      Title: '2. 任课教师是否有迟到、早退、旷课或找人代课的现象？',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: false },
        Items: {
          Options: [
            { Id: 1021, Title: 'A. 经常有', BandScore: 0 },
            { Id: 1022, Title: 'B. 偶尔有（1-2次）', BandScore: 0 },
            { Id: 1023, Title: 'C. 从不，没有任何违规现象', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 103,
      SortNumber: 2,
      SubjectType: 1, // 单选题
      Title: '3. 教师备课充分，精神饱满，严格遵守课堂纪律，做到了按时上下课：',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: true },
        Items: {
          Options: [
            { Id: 1031, Title: 'A. 非常符合', BandScore: 10 },
            { Id: 1032, Title: 'B. 比较符合', BandScore: 8 },
            { Id: 1033, Title: 'C. 一般', BandScore: 6 },
            { Id: 1034, Title: 'D. 不太符合', BandScore: 4 },
            { Id: 1035, Title: 'E. 很不符合', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 104,
      SortNumber: 3,
      SubjectType: 1, // 单选题
      Title: '4. 您认为本门课程的教学内容与教学资源丰富程度如何？',
      Score: 15,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: true },
        Items: {
          Options: [
            { Id: 1041, Title: 'A. 课程内容单薄，照本宣科', BandScore: 5 },
            { Id: 1042, Title: 'B. 内容一般，仅局限于教材', BandScore: 9 },
            { Id: 1043, Title: 'C. 课程内容比较丰富，有一定拓展', BandScore: 12 },
            { Id: 1044, Title: 'D. 课程很丰富，案例充实且紧跟学科前沿', BandScore: 15 }
          ]
        }
      }
    },
    {
      Id: 105,
      SortNumber: 4,
      SubjectType: 1, // 单选题
      Title: '5. 教师讲解条理清晰、重点突出，注重启发学生思维与课堂互动：',
      Score: 15,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: true },
        Items: {
          Options: [
            { Id: 1051, Title: 'A. 非常满意', BandScore: 15 },
            { Id: 1052, Title: 'B. 满意', BandScore: 12 },
            { Id: 1053, Title: 'C. 一般', BandScore: 9 },
            { Id: 1054, Title: 'D. 不满意', BandScore: 5 },
            { Id: 1055, Title: 'E. 非常不满意', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 106,
      SortNumber: 5,
      SubjectType: 1, // 单选题
      Title: '6. 本课程的授课进度、课程难度及课后作业量安排是否合理？',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: false },
        Items: {
          Options: [
            { Id: 1061, Title: 'A. 进度太快，难度过大，作业负担过重', BandScore: 0 },
            { Id: 1062, Title: 'B. 非常合理，难易适中、进度恰当', BandScore: 0 },
            { Id: 1063, Title: 'C. 进度偏慢，内容太简单，作业偏少', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 107,
      SortNumber: 6,
      SubjectType: 1, // 单选题
      Title: '7. 教师对课后作业批改、实验指导及课外答疑辅导的及时性与认真程度：',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: true },
        Items: {
          Options: [
            { Id: 1071, Title: 'A. 非常及时认真，辅导耐心细致', BandScore: 10 },
            { Id: 1072, Title: 'B. 比较及时认真', BandScore: 8 },
            { Id: 1073, Title: 'C. 一般', BandScore: 6 },
            { Id: 1074, Title: 'D. 不够及时，较为敷衍', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 108,
      SortNumber: 7,
      SubjectType: 2, // 多选题（正向）
      Title: '8. 通过本课程的期中学习，您在以下哪些方面获得了明显收获？（多选题）',
      Score: 10,
      Props: {
        CustomAttr: {
          IsAllowNull: false,
          IsSetScore: false,
          DataOptions: { MinAnswerNumber: 1, MaxAnswerNumber: 5 }
        },
        Items: {
          Options: [
            { Id: 1081, Title: 'A. 扎实掌握了本课程的基础理论与核心知识', BandScore: 0, IsExclusive: false },
            { Id: 1082, Title: 'B. 课程内容很丰富，拓宽了专业学术视野', BandScore: 0, IsExclusive: false },
            { Id: 1083, Title: 'C. 提升了分析问题与解决实际问题的能力', BandScore: 0, IsExclusive: false },
            { Id: 1084, Title: 'D. 激发了对本专业的学习兴趣与自主探究精神', BandScore: 0, IsExclusive: false },
            { Id: 1085, Title: 'E. 毫无收获，听不懂课程内容', BandScore: 0, IsExclusive: true }
          ]
        }
      }
    },
    {
      Id: 109,
      SortNumber: 8,
      SubjectType: 2, // 多选题（负面排查）
      Title: '9. 您认为本门课程或任课教师在教学中存在以下哪些问题或不足？（多选题）',
      Score: 0,
      Props: {
        CustomAttr: {
          IsAllowNull: false,
          IsSetScore: false,
          DataOptions: { MinAnswerNumber: 1, MaxAnswerNumber: 5 }
        },
        Items: {
          Options: [
            { Id: 1091, Title: 'A. 存在迟到早退或违规调停课现象', BandScore: 0, IsExclusive: false },
            { Id: 1092, Title: 'B. 讲课照本宣科、念PPT，缺乏互动', BandScore: 0, IsExclusive: false },
            { Id: 1093, Title: 'C. 课程内容陈旧枯燥，缺少案例拓展', BandScore: 0, IsExclusive: false },
            { Id: 1094, Title: 'D. 作业批改不及时，课后缺乏答疑', BandScore: 0, IsExclusive: false },
            { Id: 1095, Title: 'E. 以上均无（没有违反规定，无上述问题）', BandScore: 0, IsExclusive: true }
          ]
        }
      }
    },
    {
      Id: 110,
      SortNumber: 9,
      SubjectType: 1, // 单选题
      Title: '10. 总体而言，您对本门课程及任课教师的教学效果满意度如何？',
      Score: 10,
      Props: {
        CustomAttr: { IsAllowNull: false, IsSetScore: true },
        Items: {
          Options: [
            { Id: 1101, Title: 'A. 非常满意', BandScore: 10 },
            { Id: 1102, Title: 'B. 比较满意', BandScore: 8 },
            { Id: 1103, Title: 'C. 一般', BandScore: 6 },
            { Id: 1104, Title: 'D. 不太满意', BandScore: 4 },
            { Id: 1105, Title: 'E. 非常不满意', BandScore: 0 }
          ]
        }
      }
    },
    {
      Id: 111,
      SortNumber: 10,
      SubjectType: 7, // 滑块打分题
      Title: '11. 请您对任课教师的综合教学表现进行打分（0-100分）：',
      Score: 100,
      Props: {
        CustomAttr: {
          IsAllowNull: false,
          IsSetScore: true,
          DataOptions: { MinValue: 0, MaxValue: 100 }
        },
        Items: {
          Options: [{ Id: 1111, Title: '综合评分' }]
        }
      }
    },
    {
      Id: 112,
      SortNumber: 11,
      SubjectType: 0, // 意见反馈题 / 主观建议题（非必答）
      Title: '12. 您对本门课程或任课教师还有哪些意见或建议？（选答）',
      Score: 0,
      Props: {
        CustomAttr: {
          IsAllowNull: true, // 明确为非必答
          IsSetScore: false,
          DataOptions: { MinTextNumber: 0 }
        },
        Items: {
          Options: [{ Id: 1121, Title: '主观评价' }]
        }
      }
    },
    {
      Id: 113,
      SortNumber: 12,
      SubjectType: 1, // 非必答单选题
      Title: '13. 您是否有意愿在下学期继续选修该任课教师开设的其他进阶选修课？（选答）',
      Score: 0,
      Props: {
        CustomAttr: {
          IsAllowNull: true, // 非必答
          IsSetScore: false
        },
        Items: {
          Options: [
            { Id: 1131, Title: 'A. 非常有意愿', BandScore: 0 },
            { Id: 1132, Title: 'B. 视课程时间安排而定', BandScore: 0 },
            { Id: 1133, Title: 'C. 暂不考虑', BandScore: 0 }
          ]
        }
      }
    }
  ]
};

const report = Evaluator.evaluateQuestionnaire(mockMiddleQuestionnaireData);

// 验证必答题的理想化答案
assert.strictEqual(report.questions[0].selectedOptionIds[0], 1013, '第1题应选：C. 没有违反规定，严格遵守教学规范');
assert.strictEqual(report.questions[1].selectedOptionIds[0], 1023, '第2题应选：C. 从不，没有任何违规现象');
assert.strictEqual(report.questions[2].selectedOptionIds[0], 1031, '第3题应选：A. 非常符合');
assert.strictEqual(report.questions[3].selectedOptionIds[0], 1044, '第4题应选：D. 课程很丰富，案例充实且紧跟学科前沿');
assert.strictEqual(report.questions[4].selectedOptionIds[0], 1051, '第5题应选：A. 非常满意');
assert.strictEqual(report.questions[5].selectedOptionIds[0], 1062, '第6题应选：B. 非常合理，难易适中、进度恰当');
assert.strictEqual(report.questions[6].selectedOptionIds[0], 1071, '第7题应选：A. 非常及时认真，辅导耐心细致');
assert.deepStrictEqual(report.questions[7].selectedOptionIds.sort(), [1081, 1082, 1083, 1084], '第8题正向多选应全选4个收获项');
assert.deepStrictEqual(report.questions[8].selectedOptionIds, [1095], '第9题负面排查多选应仅选：E. 以上均无');
assert.strictEqual(report.questions[9].selectedOptionIds[0], 1101, '第10题应选：A. 非常满意');
assert.strictEqual(report.questions[10].selectedOptionIds[0], 100, '第11题打分题应给满分 100 分');

// 关键验证：非必答问题（第12题意见建议、第13题非必答单选）必须直接不填写！
assert.strictEqual(report.questions[11].isRequired, false, '第12题应被识别为非必答题');
assert.strictEqual(report.questions[11].selectedOptionIds.length, 0, '第12题意见建议题不应有选项');
assert.strictEqual(report.questions[11].summaryText, '（非必答题，直接不填写）', '第12题意见建议题应标记为直接不填写');
assert.strictEqual(report.mergedFormFields['112'], undefined, '第12题不应写入表单字段');

assert.strictEqual(report.questions[12].isRequired, false, '第13题应被识别为非必答题');
assert.strictEqual(report.questions[12].selectedOptionIds.length, 0, '第13题非必答单选题不应选择任何项');
assert.strictEqual(report.questions[12].summaryText, '（非必答题，直接不填写）', '第13题应标记为直接不填写');
assert.strictEqual(report.mergedFormFields['113'], undefined, '第13题不应写入表单字段');

console.log('=== ALL 13/13 ASSERTIONS PASSED ===');
console.log(JSON.stringify(report, null, 2));
