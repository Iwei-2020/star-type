'use strict';

// ─────────────────────────────────────────────────────────────
// 本文件由 tools/gen-strings.js 生成：叙事文案提取自 4 份【内容叙事】资产，
// 界面静态文案合入生成器内集中声明的 UI_TEXT（见该文件顶部说明）。
// 禁止手改：改动会在下一次生成时被覆盖，且 gen-strings.js --check 会失败。
// 叙事文案改资产原文；界面文案改 tools/gen-strings.js 的 UI_TEXT，然后重新运行生成。
// ─────────────────────────────────────────────────────────────
module.exports = Object.freeze({
  "ui": Object.freeze({
    "home": Object.freeze({
      "brand": "星语人格",
      "brandSub": "好友同频测试",
      "spec": "10 道题 · 约 3 分钟 · 无需注册",
      "ctaStart": "开始测试",
      "ctaPair": "已有邀请码 · 直接配对",
      "ctaResume": "继续上次答题",
      "tagline": "3 分钟完成一次人格映像测试，点亮独属于你的人格原型符号卡，再邀请好友生成一张\"同频图谱\"。"
    }),
    "guide": Object.freeze({
      "title": "开始之前",
      "subtitle": "三步看懂这次测试",
      "steps": Object.freeze([
        Object.freeze({
          "no": "1",
          "title": "回答 10 道题",
          "desc": "凭第一感受二选一，没有对错，也不用纠结。"
        }),
        Object.freeze({
          "no": "2",
          "title": "生成人格映像卡",
          "desc": "得到你的原型符号与特质解读。"
        }),
        Object.freeze({
          "no": "3",
          "title": "邀请好友配对",
          "desc": "生成一张同频图谱，看你们的相处模式。"
        })
      ]),
      "note": "预计用时：约 3 分钟",
      "noteResume": "上次进度已保留",
      "cta": "开始答题"
    }),
    "quiz": Object.freeze({
      "progress": "第 {n} / {total} 题",
      "back": "上一题",
      "hint": "作答即进入下一题 · 可返回上一题修改",
      "hintLast": "生成结果"
    }),
    "result": Object.freeze({
      "ctaInvite": "邀请好友配对",
      "ctaShare": "分享",
      "loadingTitle": "正在生成你的人格映像",
      "loadingSub": "星点正在聚合，请稍候",
      "loadingCta": "生成中…",
      "failTitle": "未能生成结果",
      "failText": "网络似乎不太稳定，你的人格映像没有生成成功。可以重新试一次。",
      "failCta": "重新生成",
      "pairCodeLabel": "配对码",
      "imageryLabel": "主导意象",
      "relationLabel": "相处模式提示"
    }),
    "pair": Object.freeze({
      "title": "同频图谱",
      "roleSelf": "你的卡",
      "roleInviter": "发起者",
      "roleInvitee": "受邀者",
      "pendingName": "待完成",
      "waitText": "等待对方完成测试…",
      "waitCta": "再次邀请",
      "expiredTitle": "本次邀请已过期",
      "expiredSub": "邀请有效期 7 天",
      "expiredCta": "重新发起配对",
      "markSame": "一致",
      "markComp": "互补",
      "bandPrefix": "相处模式：",
      "shareCta": "分享图谱",
      "switchCta": "换个好友配对",
      "inputHint": "输入好友的 8 位配对码",
      "inputPlaceholder": "8 位字母与数字",
      "inputCta": "确认配对",
      "inputInvalid": "配对码格式不正确，请核对后再试",
      "inputAmbiguous": "配对码不含 I / L / O / 0 / 1 这几个易混字符",
      "inputNotFound": "没有找到这个邀请，请核对配对码",
      "dims": Object.freeze({
        "D1": Object.freeze({
          "title": "D1 表达",
          "a": "外显",
          "b": "内隐"
        }),
        "D2": Object.freeze({
          "title": "D2 能量",
          "a": "炽放",
          "b": "静蓄"
        }),
        "D3": Object.freeze({
          "title": "D3 决策",
          "a": "理性",
          "b": "感性"
        }),
        "D4": Object.freeze({
          "title": "D4 关系",
          "a": "主动",
          "b": "随和"
        })
      })
    }),
    "share": Object.freeze({
      "title": "分享给好友",
      "subtitle": "邀请 TA 完成测试，一起看同频图谱",
      "ctaInvite": "去邀请配对",
      "ctaRetry": "再测一次",
      "channels": Object.freeze([
        Object.freeze({
          "key": "friend",
          "label": "抖音好友"
        }),
        Object.freeze({
          "key": "group",
          "label": "抖音群"
        }),
        Object.freeze({
          "key": "save_image",
          "label": "保存图片"
        }),
        Object.freeze({
          "key": "copy_code",
          "label": "复制配对码"
        })
      ])
    })
  }),
  "disclaimers": Object.freeze({
    "home": "本测试为趣味娱乐内容，结果依据你的主观作答生成，仅供娱乐与社交互动参考；不构成心理学专业测评、心理诊断或咨询建议，也不构成任何形式的命运、运势或未来推断。",
    "guide": "本测试为趣味娱乐内容，结果仅供娱乐参考；不构成心理学专业测评、心理诊断或咨询建议，也不构成任何形式的命运、运势或未来推断。",
    "quiz": "请凭第一感受作答，结果仅供娱乐参考。",
    "result": "本结果基于趣味叙事模型生成，仅供娱乐，不作为心理诊断或专业测评依据。",
    "pair": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。",
    "share": "娱乐测试 · 结果仅供参考"
  }),
  "quiz": Object.freeze({
    "intro": "请凭第一感受作答，结果仅供娱乐参考。",
    "questionPrompt": "下面哪种情况更接近你的通常状态？",
    "questions": Object.freeze([
      Object.freeze({
        "id": "Q1",
        "dim": "D1",
        "stem": "一群朋友刚坐下，气氛还没热起来。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "外显",
            "text": "先开口，把话题带起来。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "内隐",
            "text": "先听一会儿，等话题自然落到你身上。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q2",
        "dim": "D2",
        "stem": "周末有两整天可以自由安排。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "炽放",
            "text": "想把行程排满，出门见人、去没去过的地方。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "静蓄",
            "text": "想留出大段空白，一个人待着缓一缓。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q3",
        "dim": "D3",
        "stem": "面对一个需要做决定的机会（比如换方向、报名一件事）。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "理性",
            "text": "先比较实际的利弊与可行性，再决定。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "感性",
            "text": "先感觉这件事是不是自己想要的。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q4",
        "dim": "D4",
        "stem": "认识了一个你觉得可以成为朋友的新朋友。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "主动",
            "text": "你会先发消息、先约一次。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "随和",
            "text": "你更愿意等自然的时机，慢慢熟起来。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q5",
        "dim": "D1",
        "stem": "你的看法和别人不太一样时。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "外显",
            "text": "你倾向于当场把自己的看法说出来。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "内隐",
            "text": "你倾向于先放在心里，看场合再决定说不说。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q6",
        "dim": "D2",
        "stem": "连续和一群人待了一整天之后。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "炽放",
            "text": "你还想继续，觉得越聊越有劲。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "静蓄",
            "text": "你需要独处一会儿才能回血。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q7",
        "dim": "D3",
        "stem": "朋友来问你的建议，请你帮他拿个主意。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "理性",
            "text": "你会先帮着把事实和选项理清楚。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "感性",
            "text": "你会先站在对方的心情上想。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q8",
        "dim": "D4",
        "stem": "和关系不错的搭子相处时。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "主动",
            "text": "你更常是提议去哪、定计划的那一方。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "随和",
            "text": "你更常是\"都行、你定就好\"的那一方。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q9",
        "dim": "D1",
        "stem": "在群聊或一个小团队里。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "外显",
            "text": "你更常是发言、接话、推动进度的人。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "内隐",
            "text": "你更常是看着、点头、关键时刻说一句的人。"
          })
        ])
      }),
      Object.freeze({
        "id": "Q10",
        "dim": "D2",
        "stem": "一天当中你状态最好的时候。",
        "options": Object.freeze([
          Object.freeze({
            "id": "A",
            "endpoint": "炽放",
            "text": "白天，人比较多、事情在推进的时候。"
          }),
          Object.freeze({
            "id": "B",
            "endpoint": "静蓄",
            "text": "夜深，周围安静下来的时候。"
          })
        ])
      })
    ])
  }),
  "archetypes": Object.freeze({
    "AAAA": Object.freeze({
      "code": "AAAA",
      "name": "曜日型",
      "symbol": "正午恒星",
      "summary": "你倾向于把能量向外打开，像正午的恒星一样稳定地发着光。",
      "traits": Object.freeze([
        "你倾向于率先表达想法，在需要有人开场的场合里，更容易成为那个先开口的人。",
        "你倾向于按条理梳理问题，面对选择时更容易先看事实与条件，再谈感受。",
        "你倾向于主动靠近，在关系里常常是推进节奏的那一方。"
      ]),
      "relationHint": "和偏向内隐、静蓄的人相处时，你的热意会慢慢把对方带进来。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "AAAB": Object.freeze({
      "code": "AAAB",
      "name": "日珥型",
      "symbol": "恒星烈焰边缘",
      "summary": "你倾向于向外表达、能量充足，节奏比曜日型更跳脱，像恒星边缘扬起的烈焰。",
      "traits": Object.freeze([
        "你倾向于快速给出立场，在讨论里更容易先抛结论。",
        "你倾向于先看逻辑，遇到说不通的说法时更容易当场指出。",
        "你倾向于主动靠近感兴趣的人，也容易为一段关系带来新鲜感。"
      ]),
      "relationHint": "你更在意相处时的节奏感，而不是每次都得出统一结论。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "AABA": Object.freeze({
      "code": "AABA",
      "name": "彗尾型",
      "symbol": "掠过的彗星轨迹",
      "summary": "你倾向于向外表达、能量炽放，做判断时偏向感受，像掠过的彗星留下一道独属于你的轨迹。",
      "traits": Object.freeze([
        "你倾向于说出当下的真实感受，在气氛需要被点燃时更容易站出来。",
        "你倾向于依靠直觉与当下的心情做选择。",
        "你倾向于在关系里主动，也常带着对方去尝试新的东西。"
      ]),
      "relationHint": "和你相处时，给空间往往比给建议更有效。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "AABB": Object.freeze({
      "code": "AABB",
      "name": "极光型",
      "symbol": "高空光帘",
      "summary": "你倾向于向外表达、能量炽放，判断偏感受、相处随和，像一整片铺开的高空光帘。",
      "traits": Object.freeze([
        "你倾向于把情绪写在脸上，在热闹的场合更容易融进去。",
        "你倾向于看重此刻的感受与人的状态，再决定怎么回应。",
        "你倾向于在关系里随和配合，不争主导，也不介意跟着对方的节奏。"
      ]),
      "relationHint": "安静的陪伴对你来说也是一种回应。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "ABAA": Object.freeze({
      "code": "ABAA",
      "name": "晨星型",
      "symbol": "破晓启明星",
      "summary": "你倾向于把想法说清楚，但能量偏静蓄，判断偏条理、相处主动，像天将亮时那颗最亮的星。",
      "traits": Object.freeze([
        "你倾向于把想法讲明白，但不追求成为全场的焦点。",
        "你倾向于依据逻辑与依据做判断，情绪不容易左右结论。",
        "你倾向于在关系里持续而稳定地靠近，而不是一时的热烈。"
      ]),
      "relationHint": "你的在意不靠音量表达，而靠一直在场。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "ABAB": Object.freeze({
      "code": "ABAB",
      "name": "双星型",
      "symbol": "相互环绕的双星",
      "summary": "你倾向于清晰表达而不张扬，能量稳定、判断偏条理、相处随和，像两颗各自有轨道又彼此同行的星。",
      "traits": Object.freeze([
        "你倾向于用讲道理的方式表达，在争论里更容易成为做梳理的那一方。",
        "你倾向于稳定而持久地投入，不追求一时的爆发。",
        "你倾向于在关系里随和，不抢主导，却常常是把关系托住的人。"
      ]),
      "relationHint": "你更适合能并肩同行、不必比高低的伙伴。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "ABBA": Object.freeze({
      "code": "ABBA",
      "name": "潮汐型",
      "symbol": "被牵引的海面",
      "summary": "你倾向于把感受讲出来，能量内收而持久、判断偏感受、相处随和，像随潮汐缓慢涨落的海面。",
      "traits": Object.freeze([
        "你倾向于坦白说出感受，但不急着说服别人接受。",
        "你倾向于依据人与人的状态做判断，而不是单看条件。",
        "你倾向于在关系里随和，容易被对方的情绪带动。"
      ]),
      "relationHint": "你在关系里会给得很多，记得也留一部分给自己。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "ABBB": Object.freeze({
      "code": "ABBB",
      "name": "深海型",
      "symbol": "深水中的暗流",
      "summary": "你倾向于在信任的人面前才把话说透，能量内收、感受丰富、相处随和，像深水里缓慢流动的暗流，安静但有力量。",
      "traits": Object.freeze([
        "你倾向于先观察再开口，在熟悉的场域里才慢慢展开自己。",
        "你倾向于缓慢而持久地投入，一旦认定便不容易撤出。",
        "你倾向于在关系里体贴，习惯把对方的感受放在前面。"
      ]),
      "relationHint": "快节奏的关系会让你消耗，慢慢走近更适合你。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BAAA": Object.freeze({
      "code": "BAAA",
      "name": "星芒型",
      "symbol": "单颗高亮恒星",
      "summary": "你倾向于少说但说重点，能量集中、判断偏条理、相处主动，像一颗独自高亮的星。",
      "traits": Object.freeze([
        "你倾向于把话收着说，说出口的往往是有分量的部分。",
        "你倾向于在认定方向后快速行动，不习惯反复拉扯。",
        "你倾向于主动靠近，但靠近的方式带着分寸感。"
      ]),
      "relationHint": "你的安静不等于疏离，先解释一句会让对方更安心。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BAAB": Object.freeze({
      "code": "BAAB",
      "name": "星雾型",
      "symbol": "弥漫的星云薄雾",
      "summary": "你倾向于先观察再表达，能量充沛而内收、判断偏条理、相处随和，像一层慢慢铺开的星云薄雾。",
      "traits": Object.freeze([
        "你倾向于在不熟悉的场合保持安静，熟悉之后话才会多起来。",
        "你倾向于为在意的事投入大量精力，做事讲究条理。",
        "你倾向于在关系里随和，不争主导，也不介意为别人让位。"
      ]),
      "relationHint": "你需要一个不催促你表达的环境。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BABA": Object.freeze({
      "code": "BABA",
      "name": "月晕型",
      "symbol": "安静月轮光晕",
      "summary": "你倾向于把情绪收在里面，能量安静、感受细腻、相处主动而含蓄，像月轮外那圈安静的光晕。",
      "traits": Object.freeze([
        "你倾向于在足够安全的场合才流露情绪。",
        "你倾向于安静而绵长地投入，适合独自深耕一件事。",
        "你倾向于用默默的、具体的方式靠近在意的人。"
      ]),
      "relationHint": "你的关心是具体的行动，而不是响亮的话。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BABB": Object.freeze({
      "code": "BABB",
      "name": "星砂型",
      "symbol": "缓慢漂移的星尘",
      "summary": "你倾向于不主动表达，但感受细密，能量平缓、相处随和，像缓慢漂移的星尘，轻、静、随处可安放。",
      "traits": Object.freeze([
        "你倾向于把话放在心里，却能第一时间察觉到别人的情绪变化。",
        "你倾向于在松弛的节奏里做事，不喜欢仓促与冲撞。",
        "你倾向于在关系里包容，容易配合别人的安排。"
      ]),
      "relationHint": "你常常照顾所有人，也值得被照顾一次。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BBAA": Object.freeze({
      "code": "BBAA",
      "name": "极星型",
      "symbol": "恒定的坐标星",
      "summary": "你倾向于想清楚再说，能量稳定、判断偏条理、相处主动，像那颗始终待在原位、用来定位的星。",
      "traits": Object.freeze([
        "你倾向于讲话不铺垫但很稳，习惯先想清楚再开口。",
        "你倾向于保持稳定，不容易被外界的情绪带偏。",
        "你倾向于主动发起关系，但更在意方向对不对、走不走得远。"
      ]),
      "relationHint": "你给出的是稳定的坐标，而不是热烈的即时回应。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BBAB": Object.freeze({
      "code": "BBAB",
      "name": "萤火型",
      "symbol": "深空里的微光",
      "summary": "你倾向于在被问到时才表达，能量安静、判断偏条理、相处随和，像深空里一闪一闪的微光。",
      "traits": Object.freeze([
        "你倾向于在有需要时才给出观点，但心里早有判断。",
        "你倾向于按自己的节奏推进事情，不急着证明什么。",
        "你倾向于在关系里温和、随和，不给人压力。"
      ]),
      "relationHint": "你的光很淡，但一直在。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BBBA": Object.freeze({
      "code": "BBBA",
      "name": "静湖型",
      "symbol": "倒映星空的湖面",
      "summary": "你倾向于把想法放在心里，能量沉静、感受细腻、相处主动而含蓄，像一面倒映着星空的静湖。",
      "traits": Object.freeze([
        "你倾向于用作品或行动替自己说话，而不是靠语言。",
        "你倾向于被细节打动，感官细腻，容易记挂很久。",
        "你倾向于主动去在意的人身边，但很少用语言点破。"
      ]),
      "relationHint": "你需要的是能读懂你沉默的人。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    }),
    "BBBB": Object.freeze({
      "code": "BBBB",
      "name": "夜幕型",
      "symbol": "静谧的深夜穹顶",
      "summary": "你倾向于说得很少，能量向内、感受很深、相处随和，像一整片静谧的深夜穹顶，把所有的光都收在里面。",
      "traits": Object.freeze([
        "你倾向于不主动表达，但心里知道的比说出口的多。",
        "你倾向于独处与长时间思考，能量沉在内部。",
        "你倾向于在关系里极随和，几乎不与人起冲突。"
      ]),
      "relationHint": "你的世界很深，值得有人耐心待在里面。",
      "disclaimer": "本解读为趣味叙事内容，仅供娱乐参考。"
    })
  }),
  "bands": Object.freeze([
    Object.freeze({
      "c": 0,
      "label": "极致互补型",
      "summary": "四个维度上你们都在相反的两端。同一件事，你们的第一反应往往不同，也因此更容易看到对方没有看到的那一面。",
      "hints": Object.freeze([
        "你们几乎处处不同，一开始可能会觉得彼此节奏对不上。",
        "反过来看，四个维度都有两种视角，能覆盖的角度也更宽。",
        "差异多的组合里，把「为什么这么想」讲清楚，比直接给结论更有用。"
      ]),
      "disclaimer": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。"
    }),
    Object.freeze({
      "c": 1,
      "label": "差异互补型",
      "summary": "你们在四个维度里只有一处相同，其余三处相反。共同点不多，但差异并不等于冲突——相反的两端，往往对应两种可以互相补足的做法。",
      "hints": Object.freeze([
        "你们的相似之处不多，但那一处通常会让你们觉得「原来你也这样」。",
        "三处差异意味着同一件事你们常有两种解法，可以比较之后再决定用哪种。",
        "差异较多时，把分歧当作偏好不同、而不是对错之争，沟通会顺一些。"
      ]),
      "disclaimer": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。"
    }),
    Object.freeze({
      "c": 2,
      "label": "均衡互补型",
      "summary": "四个维度里，你们两处同频、两处互补。既能理解彼此，也会在固定的话题上出现不同的偏好。这种半对半的组合，通常表现为聊得来，也各有各的走法。",
      "hints": Object.freeze([
        "两处同频的部分，让你们的基础沟通成本不高。",
        "两处互补的部分，容易成为你们分工时的天然依据。",
        "遇到分歧时，先分辨这处差异属于哪一类，通常比直接争论更有效。"
      ]),
      "disclaimer": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。"
    }),
    Object.freeze({
      "c": 3,
      "label": "高默契型",
      "summary": "你们在四个维度里有三处落在同一端，剩下一处不同。相似的地方多，差异只有一条，所以磨合点通常比较集中，也比较容易被辨认出来。",
      "hints": Object.freeze([
        "三处同频让你们在大多数话题上不需要反复解释。",
        "剩下那一处差异，往往是你们互相提醒的地方。",
        "差异只有一条，意味着它更容易被看见，而不是被忽略。"
      ]),
      "disclaimer": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。"
    }),
    Object.freeze({
      "c": 4,
      "label": "同频共振型",
      "summary": "你们在四个维度上都落在同一端：表达方式、能量节奏、做选择的路子、相处时的主动程度，彼此都在相似的位置。这种组合的特点是彼此比较容易预判对方的反应，交流时通常不需要额外的解释。",
      "hints": Object.freeze([
        "你们的表达节奏接近，聊天时不太容易出现一方追着、一方接话的情况。",
        "做选择时你们容易顺着类似的思路走，达成一致一般不需要太多回合。",
        "相似也意味着盲区接近，遇到视角不同的人时，你们可能都想不到那个角度。"
      ]),
      "disclaimer": "同频度为娱乐化叙事指标，仅反映双方作答的相似与互补，仅供社交互动参考。"
    })
  ]),
  "pairStates": Object.freeze({
    "waiting": "等待对方完成测试；提供再次分享入口",
    "expired": "本次邀请已过期，可重新发起配对",
    "completed": "展示同频图谱与本节 5 档叙事"
  })
});
