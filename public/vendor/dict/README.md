# 离线英汉词典来源与许可

`en_zh.txt` 由 [ECDICT](https://github.com/skywind3000/ECDICT)（**MIT License**）的
`ecdict.csv` 裁剪而来。

- 原始文件：https://github.com/skywind3000/ECDICT/blob/master/ecdict.csv
- 上游项目：https://github.com/skywind3000/ECDICT

## 裁剪规则

只保留「常用词」条目，即满足**任一**条件：

- 在英国国家语料库（`bnc`）或当代语料库（`frq`）里有词频排名
- 有考试大纲标签（`tag`：中高考 / 四六级 / 考研 / 雅思 / 托福 / GRE 等）
- 是柯林斯星级词（`collins`）或牛津三千核心词（`oxford`）

据此从 768,739 条中保留 **59,137 条**（约 3MB）。生僻词、地名、人名与多词短语大多被去掉。
同一单词只保留第一条，最终按字母序排列。

## 格式

```
单词<TAB>中文释义
```

释义里的多个义项用**字面** `\n` 分隔（两个字符，不是真换行），前端显示时再还原成换行。例如：

```
abandon	vt. 放弃, 抛弃, 遗弃, 使屈从, 沉溺, 放纵\nn. 放任, 无拘束, 狂热
apple	n. 苹果, 家伙\n[医] 苹果
quay	n. 码头, 驳岸\n[经] 贴岸码头
```

只保留中文释义；ECDICT 里的英文释义（`definition`）字段没有收录。
