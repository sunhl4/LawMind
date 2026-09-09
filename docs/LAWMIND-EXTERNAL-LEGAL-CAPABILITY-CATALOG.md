# LawMind 外部法律 Agent 能力普查

> 截止时间：2026-09-07  
> 范围：GitHub 上面向 Cursor、Codex、Claude Code 及兼容 Agent 的法律 Skills、插件、MCP、工具与工作流。  
> 目标：建立接近全量的发现入口，并为 LawMind 的吸收、适配和补缺提供依据；本文件不把“找到”误写成“已经验证可用于真实案件”。  
> 去重后的规范库见 [docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md](docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md)。

## 一、结论

GitHub 上已经存在足以覆盖律师大部分日常工作类型的公开能力供给。LawMind 没有必要从空白开始逐项自研。

目前最有效的发现方式不是继续依赖零散关键词，而是以几个大型语料库为主体，再用 GitHub 多轴搜索补长尾：

- `ThomasMoreAI/legal-skills-open`：3,571 个 `SKILL.md`，39 个法域、48 个业务领域，Apache-2.0；目前看到的最大宽松许可法律 Skill 库。
- `CSlawyer1985/legal-skillhub`：2,049 个 Skill，17 个法域，带任务、法域、许可证、类型和依赖索引；适合作为发现数据库，但其中 1,891 个仅为“已收录”，158 个仅完成元数据复核，没有安装验证、样例运行或法律专业复核记录。
- `sboghossian/mini-claude-for-legal`：982 个标准 `SKILL.md`，MIT，偏中东和北非，也覆盖起草、审查、诉讼模拟、教育与连接器。
- `vivy-yi/Greater-China-Legal`：574 个 `SKILL.md`，36 个场景、5 个大中华法域，README 声明 Apache-2.0；中国业务覆盖最广的单一场景化集合之一。
- `lawve-ai/awesome-legal-skills`：263 个精选 Skill，覆盖 26 个类别；适合作为人工策展入口，具体能力的许可证仍需逐项核验。
- `anthropics/claude-for-legal`：151 个官方法律工作流 Skill，Apache-2.0；是插件结构、路由和工作流组合的首要上游基线。

这些数字不能直接相加，因为集合之间存在镜像、移植、派生和重复收录。接近全量的正确含义是：**主要聚合库已经纳入，英文和中文的核心关键词、载体、任务、法域及数据连接器均已搜索，且保留可重复搜索入口**；它不意味着 GitHub 上不会继续出现新项目。

## 二、搜索方法与边界

本轮使用 GitHub CLI 和 GitHub Search API，按以下维度组合搜索，并排除明显 fork 后再观察结果：

1. **载体**：`SKILL.md`、Agent Skills、Claude Code plugin、Codex skill、Cursor rules、MCP server、legal agent。
2. **通用任务**：contract review、legal research、drafting、litigation、due diligence、compliance、legal operations、practice management。
3. **中文任务**：法律、律师、法务、合同审查、诉讼、刑事辩护、企业合规、法律检索、中国法 MCP。
4. **专业数据源**：CourtListener、EUR-Lex、BAILII、SEC EDGAR、USPTO、Clio、Lawmatics、各国官方法律数据库。
5. **仓库结构核验**：对重点仓库递归统计真实 `SKILL.md`，读取 README、许可证和目录，不只看仓库描述。

直接关键词检索产生了数百个 Skill 候选和数百个 MCP 候选，但其中含空壳、课程作业、产品宣传、同源移植、错误命中和未声明许可证项目。因此本文件优先列出可作为能力上游或持续发现入口的仓库，不把所有搜索命中都称为可集成能力。

## 三、第一层：应整体摄取索引的能力库

### 1. 全球与跨法域

- [`ThomasMoreAI/legal-skills-open`](https://github.com/ThomasMoreAI/legal-skills-open)：3,571 个 Skill；39 法域、200+ 插件、48 业务领域；Apache-2.0。应优先摄取其 frontmatter、法域/业务目录和来源字段。
- [`CSlawyer1985/legal-skillhub`](https://github.com/CSlawyer1985/legal-skillhub)：2,049 个 Skill；中文 1,003、英文 1,046；Apache-2.0 930、MIT 162、未声明 747，另有 AGPL、NC 等。应摄取索引，不应默认复制全部正文。
- [`lawve-ai/awesome-legal-skills`](https://github.com/lawve-ai/awesome-legal-skills)：263 个精选 Skill；包括法律研究、诉讼、合同、法律运营、Office、Acrobat、数据保护等。适合作为人工推荐信号。
- [`rohasnagpal/legal-ai-skills`](https://github.com/rohasnagpal/legal-ai-skills)：162 个 Skill；MIT；声明兼容 ChatGPT、Claude、Grok、Cursor 和 Gemini。
- [`sboghossian/mini-claude-for-legal`](https://github.com/sboghossian/mini-claude-for-legal)：982 个 Skill；MIT；适合补充法律教育、模拟、知识包和中东北非法域。
- [`ThomasMoreAI/legal-skills-open`](https://github.com/ThomasMoreAI/legal-skills-open) 与 SkillHub 可能已经收录其他集合的内容。导入时必须按来源 URL、内容哈希、名称和派生关系去重。

### 2. 中国与大中华区

- [`vivy-yi/Greater-China-Legal`](https://github.com/vivy-yi/Greater-China-Legal)：574 个 Skill；中国大陆、香港、澳门、台湾、新加坡；覆盖资本市场、并购、破产、公司治理、合同、劳动、数据、知识产权、诉讼、刑事、家事等 36 场景。
- [`zhou210712/claude-for-legal-ZH`](https://github.com/zhou210712/claude-for-legal-ZH)：150 个 Skill；Apache-2.0；中国法律实务版 Claude 工作层。
- [`pa1nrui1/legal-skills`](https://github.com/pa1nrui1/legal-skills)：58 个中国法律工作流；MIT；含民事诉讼、刑事辩护、劳动争议、破产、合同、产品法务、法规检索及真实 DOCX 红线流程。
- [`cat-xierluo/legal-skills`](https://github.com/cat-xierluo/legal-skills)：61 个 Skill；法律 OCR、语音转写、元典检索、法院短信、案件建立、发票整理、诉讼分析、文书交付等。仓库按单项区分 MIT 与 CC-BY-NC，必须逐项处理。
- [`THUYRan/Legal-Skills-Chinese`](https://github.com/THUYRan/Legal-Skills-Chinese)：76 个 Skill；仓库未检测到顶层许可证，先作为研究来源。
- [`NEU-ZHA/legal-ai-skills`](https://github.com/NEU-ZHA/legal-ai-skills)：29 个 Skill；MIT；聚焦北大法宝、引用和 DOCX 工作流。
- [`FAYANHUIYING/claude-for-legal-HoriZon`](https://github.com/FAYANHUIYING/claude-for-legal-HoriZon)：69 个 Skill、9 个插件；Apache-2.0；含元典及法宝、天眼查、飞书 MCP 接入设计。
- [`zj-ai-lab/shuanglv-legal-skills`](https://github.com/zj-ai-lab/shuanglv-legal-skills)：中国律师实务工作流；文本 CC BY-SA 4.0、代码 Apache-2.0，应拆分评估。
- [`AIExcel1949/excel1949-cn-legal-skills`](https://github.com/AIExcel1949/excel1949-cn-legal-skills)：40 个 Skill、8 个专家角色；GPL-3.0，仅适合隔离研究或合规采用。

## 四、第二层：优先吸收的专项 Skill 与插件

### 合同、红线与交易

- [`anthropics/claude-for-legal`](https://github.com/anthropics/claude-for-legal)：官方 playbook review、NDA review、合同和公司法工作流基线。
- [`cat-xierluo/contract-copilot.skill`](https://github.com/cat-xierluo/contract-copilot.skill)：三层分析、四步流程、修订批注版和审查意见书；许可证需单独核验。
- [`CSlawyer1985/contract-review-pro`](https://github.com/CSlawyer1985/contract-review-pro)：中国合同审核方法论，未检测到许可证。
- [`ThomasLiu/contract-review-zh`](https://github.com/ThomasLiu/contract-review-zh)：中国委托律师合同审查，Apache-2.0。
- [`Apoorva301205/claude-legal-skill`](https://github.com/Apoorva301205/claude-legal-skill)：CUAD 风险识别、市场基准和 redline，MIT。
- [`NOMOREKKK/contract-review-skill`](https://github.com/NOMOREKKK/contract-review-skill)：中国法域十步审查、Word 原生批注、9 类合同，MIT。
- [`12754271-maker/merger-acquisition-skill`](https://github.com/12754271-maker/merger-acquisition-skill)：中国并购全流程，从尽调到交割整合，MIT。
- [`zj-ai-lab/retainer-agreement-skill`](https://github.com/zj-ai-lab/retainer-agreement-skill)：保留用户模板格式生成委托代理合同 DOCX，Apache-2.0。

### 法律研究、诉讼和文书

- [`Golden2002/legal-research-skill`](https://github.com/Golden2002/legal-research-skill)：面向 Cursor、Claude Code 和 OpenCode 的法律检索 Skill，MIT。
- [`gregmos/memoforge`](https://github.com/gregmos/memoforge)：多 Agent 法律备忘录，覆盖 intake、research、review 和 DOCX，MIT。
- [`DingDuff/dingduff-public`](https://github.com/DingDuff/dingduff-public)：律师制作的法律研究 Skill 和 Claude 插件；许可证需逐项核验。
- [`MiaoQichuan/new-litigation-visualization`](https://github.com/MiaoQichuan/new-litigation-visualization)：诉讼时间轴和关系图生成，MIT。
- [`SimbaCD/legal-period-manager-skills`](https://github.com/SimbaCD/legal-period-manager-skills)：诉讼、执行、仲裁期限管理，MIT。
- [`yxk-lawyer/litigation-prep-skill-cn`](https://github.com/yxk-lawyer/litigation-prep-skill-cn)：中国民事诉讼准备与请求权基础分析；许可证需核验。
- [`zhang-lawyer-org/zhang-civil-litigation`](https://github.com/zhang-lawyer-org/zhang-civil-litigation)：民商事诉讼全流程，MIT。
- [`zhang-lawyer-org/zhang-due-diligence-`](https://github.com/zhang-lawyer-org/zhang-due-diligence-)：股权、资产与合规尽调，MIT。
- [`Darhous/arabic-legal-research-skill`](https://github.com/Darhous/arabic-legal-research-skill)：阿拉伯语法律检索验证与 DOCX 交付；许可证需核验。
- [`lowtidebuild/legal-writing-agent`](https://github.com/lowtidebuild/legal-writing-agent)：非合同法律文书起草和修订，Apache-2.0。
- [`lowtidebuild/second-review-agent`](https://github.com/lowtidebuild/second-review-agent)：AI 法律文书第二轮复核，Apache-2.0。

### 法律运营和律师事务所管理

- [`legalopsconsulting/lpm-skills`](https://github.com/legalopsconsulting/lpm-skills)：16 个法律项目管理 Skill，Apache-2.0；这是 LawMind 当前容易忽视但对日常工作价值很高的领域。
- [`cat-xierluo/legal-skills`](https://github.com/cat-xierluo/legal-skills)：案件目录、法院短信、发票、会议、内容抓取和 OCR 等事务型能力。
- [`danielrosehill/Claude-Case-File`](https://github.com/danielrosehill/Claude-Case-File)：版本化案件文件容器模板，MIT。
- [`oktopeak/clio-mcp`](https://github.com/oktopeak/clio-mcp)：连接 Clio 案件管理，MIT。
- [`lawyered0/clio-mcp`](https://github.com/lawyered0/clio-mcp)：Clio Manage v4，含固定收费 matter 创建，MIT。
- [`oktopeak/lawmatics-mcp`](https://github.com/oktopeak/lawmatics-mcp)：Lawmatics 客户关系与 intake，MIT。
- [`AIF-Of-Counsel/docketbird-mcp`](https://github.com/AIF-Of-Counsel/docketbird-mcp)：DocketBird 法院文件访问，Apache-2.0。

### 合规、隐私和专业领域

- [`wnallen/dpia-generator`](https://github.com/wnallen/dpia-generator)：GDPR 第 35 条数据保护影响评估，MIT。
- [`FutureRootsDE/legal-audit-de`](https://github.com/FutureRootsDE/legal-audit-de)：德国及欧盟 DSGVO、TDDDG、UWG、AI Act，许可证需核验。
- [`Cleo-Labs-IA/skills_library`](https://github.com/Cleo-Labs-IA/skills_library)：实体产品上市合规，MIT。
- [`Phoeny-Xu/ai-transparency-compliance-skill`](https://github.com/Phoeny-Xu/ai-transparency-compliance-skill)：中国、欧盟和加州 AI 内容透明度规则；许可证需核验。
- [`oxunafufa55/claude-for-legal-china-IP`](https://github.com/oxunafufa55/claude-for-legal-china-IP)：中国知识产权工作流，Apache-2.0。
- [`ttttccxxui/AnythingButLaw`](https://github.com/ttttccxxui/AnythingButLaw)：为律师补充决策分析、博弈、会计、金融、经济和统计，MIT。
- [`ahacker-1/cre-agent-skills`](https://github.com/ahacker-1/cre-agent-skills)：商业地产承保、尽调、融资、法律和交割，Apache-2.0。

## 五、第三层：MCP 与数据工具地图

### 中国大陆与大中华数据

- [`yuandian-ailaw/yuandian-mcp-server`](https://github.com/yuandian-ailaw/yuandian-mcp-server)：法规、案例、企业信息，MIT。
- [`Emnllawlab/faxin-mcp`](https://github.com/Emnllawlab/faxin-mcp)：法信法规、裁判规则、类案，MIT；需要官网账号。
- [`DevnorsAI/devnors-data-mcp`](https://github.com/DevnorsAI/devnors-data-mcp)：裁判、法规、工商、年报、失信与被执行人数据，MIT；部分服务依赖 API Key。
- [`law-star-cn/lawstar-mcp`](https://github.com/law-star-cn/lawstar-mcp)：中国法规、语义、条款和法条引用搜索，MIT；云服务依赖需核验。
- [`abcddcbaxxxx/chinese-law-mcp`](https://github.com/abcddcbaxxxx/chinese-law-mcp)：中国网络安全、数据保护、商法和反垄断法规，Apache-2.0。
- [`hygiene-12/legal-cn-mcp-hub`](https://github.com/hygiene-12/legal-cn-mcp-hub)：中国法律 MCP 连接器管理，MIT。
- [`1wu-davy-2/LexParse-MCP`](https://github.com/1wu-davy-2/LexParse-MCP)：判决书、合同和起诉状结构化，支持中国大陆与香港；许可证需核验。
- [`GaaZeon-Hui/legal-text-splitter-mcp`](https://github.com/GaaZeon-Hui/legal-text-splitter-mcp)：中文法律条款切分，MIT。
- [`yuancafe/qichacha-skills`](https://github.com/yuancafe/qichacha-skills)：企查查企业信用和案例检索 Skill；许可证需核验。

### 台湾、香港和亚洲

- [`aa0101181514/tw-legal-rag`](https://github.com/aa0101181514/tw-legal-rag)：台湾裁判、行政函释和宪法法庭数据，MCP + CLI；许可证标记为 Other，须读具体条款。
- [`legaltechtw/taiwan-law-mcp`](https://github.com/legaltechtw/taiwan-law-mcp)：台湾法规、裁判、释宪与立法历程，MIT。
- [`yu2001-s/agentic-tw-legal-db`](https://github.com/yu2001-s/agentic-tw-legal-db)：Codex、Claude Code 通用台湾法律数据库，MIT。
- [`hkopenai/hk-law-mcp-server`](https://github.com/hkopenai/hk-law-mcp-server)：香港法律和安全数据，MIT。
- [`ashram68/korean-law-mcp`](https://github.com/ashram68/korean-law-mcp)：韩国法规、判例、条例和解释，MIT。
- [`kentaroajisaka/tax-law-mcp`](https://github.com/kentaroajisaka/tax-law-mcp)：日本税法及国税厅通达，MIT。
- [`kentaroajisaka/labor-law-mcp`](https://github.com/kentaroajisaka/labor-law-mcp)：日本劳动与社会保险法，MIT。
- [`yabooung/jp-law-citation-graph`](https://github.com/yabooung/jp-law-citation-graph)：日本成文法引用图和 MCP，Apache-2.0。

### 美国、英国、欧盟和全球

- [`Mahender22/legal-mcp`](https://github.com/Mahender22/legal-mcp)：美国案例、引用、practice management 和法院 filing，MIT。
- [`blakeox/courtlistener-mcp`](https://github.com/blakeox/courtlistener-mcp)：CourtListener 案例、案卷和法院记录，MIT。
- [`cyanheads/courtlistener-mcp-server`](https://github.com/cyanheads/courtlistener-mcp-server)：CourtListener 9M+ opinions、dockets、judges、citation networks，Apache-2.0。
- [`paulieb89/bailii-mcp`](https://github.com/paulieb89/bailii-mcp)：英国 BAILII 判例搜索和全文，许可证需核验。
- [`cyanheads/eur-lex-mcp-server`](https://github.com/cyanheads/eur-lex-mcp-server)：欧盟立法、欧盟法院判例、条约和 CELLAR 图，Apache-2.0。
- [`scimorph/eur-lex-mcp`](https://github.com/scimorph/eur-lex-mcp)：EUR-Lex，MIT。
- [`stefanoamorelli/sec-edgar-mcp`](https://github.com/stefanoamorelli/sec-edgar-mcp)：SEC EDGAR，AGPL-3.0；优先比较其他 MIT/Apache 实现。
- [`danishashko/edgar-mcp`](https://github.com/danishashko/edgar-mcp)：10-K、10-Q、8-K、XBRL 和全文搜索，MIT。
- [`anaranillc/uspto-mcp-server`](https://github.com/anaranillc/uspto-mcp-server)：USPTO 商标、专利和 PTAB，Apache-2.0。
- [`JLMY-AG/iuslink-skills`](https://github.com/JLMY-AG/iuslink-skills)：连接瑞士法律研究 MCP 的 Agent Skills，MIT。
- [`Ansvar-Systems`](https://github.com/Ansvar-Systems)：奥地利、比利时、德国、荷兰、英国、瑞典等多个国家法律 MCP；多个仓库为 Apache-2.0，部分仓库许可证不同，应逐仓核验。
- [`Lawstronaut-FZCO/lawstronaut-mcp`](https://github.com/Lawstronaut-FZCO/lawstronaut-mcp)：声称覆盖 150+ 法域；依赖外部服务且许可证为 Other，适合作为连接器候选，不作为本地真相源。

## 六、LawMind 的吸收优先级

### P0：先建“发现与导入”底座

1. 支持 Anthropic `SKILL.md` frontmatter 和目录约定。
2. 导入 GitHub 仓库、子目录或单个 Skill，并固定来源 URL、commit、内容哈希和许可证。
3. 读取 SkillHub 与 ThomasMore 的索引，建立本地候选注册表。
4. 按内容哈希、来源和语义相似度去重，保留派生关系，避免把镜像数量当能力数量。
5. 把 Skill 声明的脚本、网络、Shell、外部提交权限转换为 LawMind 的实际运行要求。

### P1：立即消化的能力组合

1. **中国法律研究**：`Golden2002/legal-research-skill` 的检索工作流 + 元典/法信 MCP + LawMind 现有来源处理。
2. **合同审查与 Word 红线**：Anthropic playbook + `pa1nrui1/legal-skills` / `contract-copilot.skill` 的计划—执行—DOCX 路径 + LawMind 现有最小修改能力。
3. **诉讼材料到交付**：材料读取、时间轴、争点、证据目录、诉讼可视化、文书起草和 DOCX 出稿组合。
4. **法律运营**：案件建立、期限、法院短信、会议转写、工时/预算、发票整理和 Clio/Lawmatics 连接。
5. **企业尽调**：企业工商/涉诉 MCP + 尽调清单 + Excel 请求清单整理 + 报告生成。

### P2：按真实用户需求扩展

- 刑事辩护、劳动争议、破产重整、并购资本市场、知识产权、数据与 AI 合规、税务、地产建工、家事继承和跨境业务。
- 国外法域不应预装全部正文；按用户法域和业务包按需安装。

## 七、重要判断

1. **“几乎找到所有”可以通过索引联合实现，而不是靠手工列完所有仓库。** 以 3,571 项全球库、2,049 项聚合索引、574 项大中华集合和 GitHub 增量搜索联合，覆盖面已经远高于从零建立 LawMind 自有 Skill 清单。
2. **数量不是质量。** SkillHub 的 2,049 项中目前没有标记为安装已验证、样例已运行或法律专业已审核的项目；大型库也可能包含薄提示词、重复移植和过时规则。
3. **宽松许可证项目已经足够多。** Apache-2.0 和 MIT 集合足以先搭主干，不需要为了追求数量优先碰未声明、NC、GPL 或 AGPL 内容。
4. **中国法律能力并不稀缺。** 现在的主要问题是去重、时效验证、数据源接通、真实材料运行和交付质量比较，而不是继续闭门编写更多静态提示词。
5. **MCP 是数据与系统连接层，Skill 是工作方法层。** LawMind 应分别管理并在任务中组合，不能把一个法律数据库连接器误认为完整律师能力。

## 八、尚未完成的验证

本轮完成的是广覆盖发现与重点仓库结构核验，尚未完成：

- 对数千个 Skill 的逐项安装和真实任务运行；
- 对中国法内容的逐条时效与专业复核；
- 对外部 MCP 的认证、价格、限流、数据使用条款和稳定性实测；
- 对重复 Skill 的内容级聚类；
- LawMind 与候选 Skill 的有/无 Skill 基线对比。

下一步不应继续无边界搜索，而应先把大型索引自动导入本地候选注册表，再进行去重、许可证过滤和分层实测；同时保留每周增量搜索，捕获 2026-09-07 之后的新项目。可重复入口：`pnpm lawmind:skills:census`（离线查询包）与 `pnpm lawmind:skills:census -- --fetch`（需 GitHub CLI，对照本目录已列仓库找新项目）。
