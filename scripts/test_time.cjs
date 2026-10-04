const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm')
const file=path.join(__dirname,'../src/shared/time.ts'),timeExports={}
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
vm.runInNewContext(compiled,{exports:timeExports})
const {parseTime,formatTime,parseMilliseconds}=timeExports;let checks=0
for(const [input,result] of [['00:02.500',2.5],['05:48.000',348],['01:02:03.004',3723.004],['60:00',3600],['00:00',0],[' 1.5 ',1.5],['23:59:59.999',86399.999],['00:00.001',.001],['100:01:02',360062]]){assert.equal(parseTime(input),result);checks++}
for(const input of ['00:60','01:60:00','00:00:60','-1','1:2:3:4','00:01.0001','','NaN']){assert.equal(parseTime(input),null);checks++}
for(const seconds of [0,.001,59.999,60,3599.999,3600,3723.004,86399.999]){assert.equal(parseTime(formatTime(seconds)),seconds);checks++}
assert.equal(formatTime(59.9996),'01:00.000');checks++
for(const [text,value] of [['0',0],['1000',1],['65000',65],['60000',60],['1',.001],[' 1234 ',1.234]]){assert.equal(parseMilliseconds(text),value);checks++}
for(const text of ['1.5','-1','01:05','','NaN','9007199254740992']){assert.equal(parseMilliseconds(text),null);checks++}
console.log(JSON.stringify({result:'passed',checks}))
