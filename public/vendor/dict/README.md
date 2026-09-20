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

---

# 词频表来源与许可

`freq.txt` 是「词汇量测试」用的分档抽样表，由
[FrequencyWords](https://github.com/hermitdave/FrequencyWords)（**MIT License**）的
`content/2018/en/en_50k.txt`（英语，5 万词，取自 OpenSubtitles 字幕语料）裁剪而来。

原始文件：https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/en/en_50k.txt

## 裁剪规则

1. **只保留 `en_zh.txt` 里也有的词**——测试的「核对」环节要显示中文释义，词典里没有的词出不了题
2. **丢掉词库里大写开头的词条**——那些基本都是人名、地名、缩写（如 `Palmer`、`Aachen`、`ABC`），不适合当测试题
3. 丢掉单字母、含空格或符号的条目，只留 `a-z` 开头的纯单词
4. 剩下的按词频从高到低排，**重新连续编号**（1 开始）

据此从 5 万词里保留 **26,404 词**（约 360KB）。名次是「在这份表里的名次」而不是原始语料名次，
所以第 N 档里正好有 N 个词，估算时可以直接用档位大小乘以认识比例。

## 格式

```
单词<TAB>名次
```

例如：

```
you	1
to	2
and	3
...
redline	26404
```

