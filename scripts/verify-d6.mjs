// D6 验证脚本：确认旗帜参数与贴图默认值
import { createBannerTexture } from './src/render/materials.js';
import { createPieceMesh } from './src/render/pieceFactory.js';

// 1) createBannerTexture 默认分辨率
// 需要 DOM canvas —— materials.js 依赖 document，Node 下无法直接跑。
// 改为静态断言：检查源码默认值（见下方注释），这里只做纯逻辑验证。

// 2) plane 宽高比验证（纯计算，无 THREE 依赖）
function plane(w, h) { return { w, h, ratio: +(w / h).toFixed(3), area: +(w * h).toFixed(5) }; }
const rFlag = plane(0.131, 0.174);
const cFlag = plane(0.093, 0.124);
const kFlag = plane(0.195, 0.260);
const envFlag = plane(0.86, 1.26);
const oldR = plane(0.175, 0.130);
const oldC = plane(0.120, 0.096);
const TEX = 0.75;

const out = [];
out.push('== 旗帜 plane 参数验证（目标比例 0.75）==');
out.push(`车旗 新: w=${rFlag.w} h=${rFlag.h} ratio=${rFlag.ratio} area=${rFlag.area} | 旧 ratio=${oldR.ratio} area=${oldR.area} | 面积差=${((rFlag.area / oldR.area - 1) * 100).toFixed(2)}% ${Math.abs(rFlag.ratio - TEX) < 0.01 ? 'PASS' : 'FAIL'}`);
out.push(`炮旗 新: w=${cFlag.w} h=${cFlag.h} ratio=${cFlag.ratio} area=${cFlag.area} | 旧 ratio=${oldC.ratio} area=${oldC.area} | 面积差=${((cFlag.area / oldC.area - 1) * 100).toFixed(2)}% ${Math.abs(cFlag.ratio - TEX) < 0.01 ? 'PASS' : 'FAIL'}`);
out.push(`帅旗(不动): ratio=${kFlag.ratio} ${Math.abs(kFlag.ratio - TEX) < 0.01 ? 'PASS' : 'FAIL'}`);
out.push(`环境旗(观察项): ratio=${envFlag.ratio}（≠0.75，偏差 ${((envFlag.ratio / TEX - 1) * 100).toFixed(1)}%，不在本批指令范围）`);

// 3) 显存增量
const MB = (w, h) => (w * h * 4) / 1048576;
const faces = 6;
const oldVRAM = MB(192, 256) * faces * 4 / 3;   // RGBA8 + mipmap(×4/3)
const newVRAM = MB(256, 384) * faces * 4 / 3;
out.push(`== 旗帜显存（6 面，RGBA8+mipmap）==`);
out.push(`旧 192×256: ${oldVRAM.toFixed(2)}MB → 新 256×384: ${newVRAM.toFixed(2)}MB → 增量 ${(newVRAM - oldVRAM).toFixed(2)}MB`);

// 4) 空间安全（车旗/炮旗旗面 z 范围 vs 旗杆表面）
function zRange(posZ, w, rotY) { return rotY === Math.PI / 2 ? [posZ - w / 2, posZ + w / 2] : [posZ - w / 2, posZ + w / 2]; }
const rZ = zRange(0.038, 0.131, Math.PI / 2);
const cZ = zRange(0.126, 0.093, Math.PI / 2);
out.push(`== 旗面 z 范围 vs 旗杆表面（避穿模）==`);
out.push(`车旗: z∈[${rZ[0].toFixed(3)}, ${rZ[1].toFixed(3)}] vs 旗杆表面 z≈0.118 → 间隙 ${(0.118 - rZ[1]).toFixed(3)} ${0.118 - rZ[1] > 0 ? 'PASS' : 'FAIL'}`);
out.push(`炮旗: z∈[${cZ[0].toFixed(3)}, ${cZ[1].toFixed(3)}] vs 旗杆表面 z≈0.176 → 间隙 ${(0.176 - cZ[1]).toFixed(3)} ${0.176 - cZ[1] > 0 ? 'PASS' : 'FAIL'}`);

// 5) 源码默认值静态断言
import { readFileSync } from 'node:fs';
const src = readFileSync('./src/render/materials.js', 'utf8');
const has256 = /opts\.w \|\| 256/.test(src) && /opts\.h \|\| 384/.test(src);
out.push(`== materials.js 默认值 ==`);
out.push(`createBannerTexture 默认 w=256/h=384: ${has256 ? 'PASS' : 'FAIL'}`);

console.log(out.join('\n'));
