# 音标词典来源与许可

`en_US.txt` 取自 [ipa-dict](https://github.com/open-dict-data/ipa-dict)（**MIT License**）的
美式英语数据 `data/en_US.txt`。该数据基于 [cmudict-ipa](https://github.com/lingz/cmudict-ipa)
（**MIT License**），后者由 CMU Pronouncing Dictionary 转写为国际音标。

原始文件：https://github.com/open-dict-data/ipa-dict/blob/master/data/en_US.txt

## 本目录文件做了两处裁剪

1. 同一单词的多个读音（原文件用逗号分隔）只保留第一个
2. 同一单词只保留一条记录（忽略大小写重复）

## 格式

```
单词<TAB>/音标/
```

例如：

```
abandon	/əˈbændən/
crucial	/ˈkɹuʃəɫ/
```

音标为美音（General American）。
