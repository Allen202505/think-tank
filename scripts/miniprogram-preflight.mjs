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

if (project?.miniprogramRoot !== 'miniprogram/') errors.push('project.config.json 的 miniprogramRoot 应为 miniprogram/');
if (project?.cloudfunctionRoot) errors.push('提审版不应配置 cloudfunctionRoot，小程序已改用自有服务器直连');
if (!project?.appid) errors.push('project.config.json 缺少 appid');
if (release && project?.appid === 'touristappid') errors.push('发布前必须替换 project.config.json 的 touristappid');

const config = fs.readFileSync(path.join(root, 'miniprogram/config.js'), 'utf8');
const apiBaseMatch = config.match(/apiBase:\s*['"]([^'"]+)['"]/);
const demoMatch = config.match(/demoMode:\s*(true|false)/);
if (!apiBaseMatch) errors.push('miniprogram/config.js 缺少 apiBase');
if (release && !/^https:\/\/[^/]+/i.test(apiBaseMatch?.[1] || '')) errors.push('发布前必须配置 HTTPS 服务器地址');
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
if (/\bwx\.cloud\b/.test(js)) errors.push('小程序不应再依赖微信云开发');
if (!/\bwx\.request\s*\(/.test(js)) errors.push('小程序缺少自有服务器请求逻辑');

const icon = path.join(root, 'submission/app-icon-144.png');
if (!fs.existsSync(icon)) errors.push('缺少 submission/app-icon-144.png');

const sessionRoute = path.join(root, 'src/app/api/mini/session/route.js');
const apiRoute = path.join(root, 'src/app/api/mini/debate/route.js');
const readingRoute = path.join(root, 'src/app/api/mini/reading/route.js');
const researchRoute = path.join(root, 'src/app/api/mini/research/route.js');
if (!fs.existsSync(sessionRoute) || !fs.existsSync(apiRoute) || !fs.existsSync(readingRoute) || !fs.existsSync(researchRoute)) {
  errors.push('缺少小程序服务器 API 路由');
}

const toolData = fs.readFileSync(path.join(root, 'miniprogram/data/researchTools.js'), 'utf8');
for (const label of ['新闻分析', '行业周期分析', '上证指数脱水', '基本面研究', '供应链瓶颈分析', '芒格教你读财报']) {
  if (!toolData.includes(label)) errors.push(`小程序研究工具缺少：${label}`);
}
if (app?.window?.navigationBarTitleText !== '大师吵股') {
  errors.push('小程序导航标题应为“大师吵股”');
}
if (!app?.pages?.includes('pages/analysis/index')) {
  errors.push('app.json 缺少 pages/analysis/index');
}

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
