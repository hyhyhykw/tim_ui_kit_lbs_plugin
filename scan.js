const fs = require("fs");
const path = require("path");
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

let pathList = [];
const keyMap = new Map();
const keyMapRevert = new Map();
const dirPaths = ["lib/pages", "lib/utils", "lib/widget"];

const singleREP = /'([^']*[^\x00-\xff]{0,200}[^']*)'/g;
const doubleREP = /"([^"]*[^\x00-\xff]{0,200}[^"]*)"/g;
const parameterREP = /(?<=\{{)[^}]*(?=\}})/g;
const dartParameterREP = /(?<=\${)[^}]*(?=\})/g;
const extractDartParaOutREP = /\${[^}]+}/g;

const readPath = (currentDirPath) => {
  fs.readdirSync(currentDirPath).forEach(function (name) {
    const filePath = path.join(currentDirPath, name);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      pathList.push(filePath);
    } else if (stat.isDirectory()) {
      readPath(filePath);
    }
  });
};

const detectChinese = (filePath, resolve, reject) => {
  fs.readFile(filePath, "utf8", (err, data) => {
    const temp = [];
    if (err) {
      console.error(err);
      reject(err);
    }
    const resultSingle = data.match(singleREP);
    if (Array.isArray(resultSingle) && resultSingle.length > 0) {
      temp.push(...resultSingle.map((item) => item.split("'")[1]));
    }
    const resultDouble = data.match(doubleREP);
    if (Array.isArray(resultDouble) && resultDouble.length > 0) {
      temp.push(...resultDouble.map((item) => item.split('"')[1]));
    }
    resolve(temp);
  });
};

const flatArray = (arr) => {
  if (Object.prototype.toString.call(arr) != "[object Array]") {
    return false;
  }
  const res = [];
  arr.map((item) => {
    if (item instanceof Array) {
      res.push(...item);
    } else {
      res.push(item);
    }
  });
  return res;
};

const dealWithResult = (originResult) => {
  const arr = flatArray(originResult).filter((item) => item);
  const noRepeatArr = Array.from(new Set(arr));
  const chineseArr = noRepeatArr.filter((item) => /[\u4e00-\u9fa5]/.test(item));
  const finalArr = chineseArr.filter((item) => !parameterREP.test(item));
  return finalArr;
};

const hashStr = (text) => {
  "use strict";

  let hash = 5381,
    index = text.length;

  while (index) {
    hash = (hash * 33) ^ text.charCodeAt(--index);
  }

  return hash >>> 0;
};

const hashKey = (value, context, onError) => {
  const key = ((`k_${`0000${hashStr(value.replace(/\s+/g, ""))}`}`).toString(36)).slice(-7);
  const existedValue = keyMap.get(context ? `${key}_${context}` : key);
  if (existedValue && existedValue !== value) {
    onError && onError((filepath) => {
        console.error("");
        console.error(filepath);
        console.error("Same sentence in different forms found:");
        console.error(`    "${existedValue}"`);
        console.error(`    "${value}"`);
      });
  } else {
    keyMap.set(context ? `${key}_${context}` : key, value);
    keyMapRevert.set(value, context ? `${key}_${context}` : key);
  }
  return key;
};

const replace = () => {
  const getReplaceValue = (origin, quotation) => {
    const val = origin.split(quotation == 1 ? "'" : '"')[1];
    const ifReplace = val && keyMapRevert.get(val) && origin.indexOf("imt") === -1;
    if(origin.indexOf("${") === -1 && ifReplace){
      return ifReplace ? `TIM_t("${val}")` : origin;
    }else if(ifReplace){
      const parameter = val.match(dartParameterREP)[0];
      const template = val.replace(extractDartParaOutREP, `{{${parameter}}}`);
      return `TIM_t_para("${template}", "${val}")(${parameter}: ${parameter})`;
    }else{
      return origin;
    }
  };

  pathList.forEach((path) => {
    if (path.indexOf("i18n") > -1) {
      return;
    }
    let data;
    try {
      data = fs.readFileSync(path, "utf8");
    } catch (err) {
      console.error(err);
      return;
    }
    const newData = data
      .replace(doubleREP, (val) => getReplaceValue(val, 2))
      .replace(singleREP, (val) => getReplaceValue(val, 1));
    if (newData != data) {
      fs.writeFile(path, newData, (err) => {
        if (err) {
          console.error(err);
          return;
        }
      });
    }
  });
};

dirPaths.forEach((item) => readPath(item));
pathList = Array.from(new Set(pathList));

Promise.all(
  pathList.map((item) => {
    return new Promise((resolve, reject) => {
      return detectChinese(item, resolve, reject);
    });
  })
).then((res) => {
  const resultArray = dealWithResult(res);
  const chineseDict = {};
  resultArray.forEach((item) => (chineseDict[hashKey(item)] = item));

  fs.writeFile(
    "lib/i18n/strings_zh.i18n.json",
    JSON.stringify(chineseDict),
    (err) => {
      if (err) {
        console.error(err);
        return;
      }
    }
  );

  fs.writeFile(
    "lib/i18n/for_dart.json",
    JSON.stringify(chineseDict).replace("${", "\\${"),
    (err) => {
      if (err) {
        console.error(err);
        return;
      }
    }
  );

  readline.question(
    `The process of scanning and hashing is finished, do you want replace for no parameter string automatically?[Y/n]`,
    (bool) => {
      if (bool === "Y") {
              // replace();
              console.log("第二次全局替换会出问题，请手动对已写的新增字符串进行包裹。");
            } else {
              console.log("请手动替换。");
            }
            console.log("请参考该文档内指引操作。https://to.woa.com/im");
            readline.close();
    }
  );
});
