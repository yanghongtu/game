# 暗影传说 · Shadow Legend

一个纯前端的 2D 动作 Roguelike RPG，单文件 JavaScript 实现，**零依赖、零构建**，双击 `index.html` 即可游玩。

![status](https://img.shields.io/badge/status-playable-brightgreen)
![deps](https://img.shields.io/badge/dependencies-0-blue)

## 快速开始

```bash
git clone https://github.com/yanghongtu/game.git
cd game
```

然后直接用浏览器打开 `index.html`。

> 也可以起个静态服务器（可选，非必需）：
> ```bash
> python -m http.server 8000
> ```
> 访问 http://localhost:8000

## 操作

| 按键 | 功能 |
|---|---|
| `W` `A` `S` `D` / 方向键 | 移动 |
| `J` / 鼠标左键 | 朝光标方向普通攻击（长按连续攻击） |
| `1` `2` `3` `4` | 释放技能 |
| `Q` | 治疗 |
| `Shift` | 闪避冲刺（带无敌帧） |
| `E` | 交互 |
| `I` | 背包 |
| `C` | 角色 / 属性面板 |
| `P` / `Esc` | 暂停 |
| `M` | 手动存档 |
| `空格` | 推进对话 |

## 玩法特色

- **实时战斗**：挥剑有攻击框与朝向，命中触发顿帧（hit stop）与屏幕震动
- **随机词条装备**：6 个装备槽位，词条强化全部战斗数值（攻击 / 防御 / 暴击 / 吸血）
- **程序生成关卡**：多阶段 Boss、精英怪词缀
- **八大精英词缀**：不同机制组合，同一场景打法不同
- **掉落保底**：连续 8 次未掉装备则必掉，稀有度随进度递增
- **三档难度**：影响敌人强度、资源产出、掉落与血量
- **四套装备套装**：2 / 4 / 6 件触发不同档位加成
- **永久升级**：死亡后可投入资源强化，降低后续难度
- **NPC 任务**与多幕剧情对话

## 项目结构

```
.
├── index.html   # 页面骨架 + 全部 CSS + UI 层（约 700 行）
├── game.js      # 游戏逻辑与渲染（约 5600 行，单文件）
└── README.md
```

**刻意不拆分 `game.js`。** 实测结论：

- 单文件解析耗时 0.42 ms，游戏逻辑仅占 0.11% 的帧预算，60 FPS 满帧运行
- JS 运行时性能与文件组织方式**无关**，拆分成模块不会更快
- 拆分会因顶层 `const` 的词法作用域问题引发 `ReferenceError`
- 改用 ES Module 会被 `file://` 协议的 CORS 策略拦截，**破坏"双击直开"这一核心体验**

## 关于代码

`game.js` 中的战斗数值统一通过 `Player.total*` getter 读取（`totalAttack` / `totalDefense` 等），
它们会把基础属性、装备词条、套装加成、连击加成合并后返回。

> 新增战斗逻辑时**请走 `total*`，不要直接读 `player.attack` / `player.defense`** ——
> 后者只有基础值，会让装备系统的加成全部失效。

## 兼容性

需要支持 Canvas 2D 的现代浏览器（Chrome / Edge / Firefox / Safari）。
存档使用 `localStorage`，按浏览器与域名隔离。
