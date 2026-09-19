import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const release = process.argv.includes('--release');
const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    errors.push(`${file} 无法解析：${error.message}`);
    return null;
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const project = readJson('project.config.json');
const app = readJson('miniprogram/app.json');
readJson('miniprogram/sitemap.json');
readJson('cloudfunctions/mini-api/package.json');
readJson('cloudfunctions/mini-api/config.json');

if (project?.miniprogramRoot !== 'miniprogram/') errors.push('project.config.json 的 miniprogramRoot 应为 miniprogram/');
if (project?.cloudfunctionRoot !== 'cloudfunctions/') errors.push('project.config.json 的 cloudfunctionRoot 应为 cloudfunctions/');
if (!project?.appid) errors.push('project.config.json 缺少 appid');
if (release && project?.appid === 'touristappid') errors.push('发布前必须替换 project.config.json 的 touristappid');

const config = fs.readFileSync(path.join(root, 'miniprogram/config.js'), 'utf8');
const envMatch = config.match(/cloudEnv:\s*['"]([^'"]+)['"]/);
const demoMatch = config.match(/demoMode:\s*(true|false)/);
if (!envMatch) errors.push('miniprogram/config.js 缺少 cloudEnv');
if (release && envMatch?.[1] === 'YOUR_CLOUD_ENV_ID') errors.push('发布前必须配置真实云环境 ID');
if (release && demoMatch?.[1] !== 'false') errors.push('发布前必须将 miniprogram/config.js 的 demoMode 设为 false');

for (const page of app?.pages || []) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) {
    const file = path.join(root, 'miniprogram', `${page}.${ext}`);
    if (!fs.existsSync(file)) errors.push(`缺少页面文件：${page}.${ext}`);
  }
}

const miniFiles = walk(path.join(root, 'miniprogram'));
const wxml = miniFiles.filter((file) => file.endsWith('.wxml')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const js = miniFiles.filter((file) => file.endsWith('.js')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');

if (/<web-view\b/i.test(wxml)) errors.push('提审版不允许使用 web-view');
if (/\bwx\.request\s*\(/.test(js)) errors.push('小程序应通过云函数请求，不应直接调用 wx.request');

const icon = path.join(root, 'submission/app-icon-144.png');
if (!fs.existsSync(icon)) errors.push('缺少 submission/app-icon-144.png');

const apiRoute = path.join(root, 'src/app/api/mini/debate/route.js');
const readingRoute = path.join(root, 'src/app/api/mini/reading/route.js');
if (!fs.existsSync(apiRoute) || !fs.existsSync(readingRoute)) errors.push('缺少小程序 Web API 路由');

if (!release) warnings.push('当前为开发预检；提交前请使用 npm run preflight:mini -- --release');

console.log('微信小程序提审预检');
console.log(`- 页面数：${app?.pages?.length || 0}`);
console.log(`- 小程序文件数：${miniFiles.length}`);
console.log(`- 模式：${release ? 'release' : 'development'}`);

for (const warning of warnings) console.log(`[WARN] ${warning}`);
for (const error of errors) console.log(`[ERROR] ${error}`);

if (errors.length) {
  console.log(`\n预检失败：${errors.length} 项`);
  process.exit(1);
}

console.log('\n预检通过');
