/**
 * 域名价格爬虫脚本
 * 
 * 工作流程：
 * 1. 生成或加载样本域名列表
 * 2. 对每个域名先进行 WHOIS 检查
 * 3. 只对可用域名抓取价格
 * 4. 存储结果到 data/prices/ 目录
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 配置
const TLD = process.env.TLD || 'com';
const FORCE = process.env.FORCE === 'true';
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '100');
const OUTPUT_DIR = join(process.cwd(), 'data', 'prices');
const STATS_FILE = join(process.cwd(), 'data', 'stats.json');

// 注册商配置
const REGISTRARS = [
  { name: 'Cloudflare', url: 'https://domains.cloudflare.com/pricing', patterns: [/\$([0-9]+\.[0-9]{2})\s*\/(year|mo)/i] },
  { name: 'Porkbun', url: 'https://porkbun.com/whois/{tld}', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
  { name: 'Namecheap', url: 'https://www.namecheap.com/domains/registration/results/?domain={tld}', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
  { name: 'GoDaddy', url: 'https://www.godaddy.com/domains/{tld}-prices', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
  { name: '阿里云', url: 'https://wanwang.aliyun.com/domain/{tld}', patterns: [/¥([0-9]+)\.([0-9]{2})/] },
  { name: '腾讯云', url: 'https://cloud.tencent.com/act/domain/{tld}', patterns: [/¥([0-9]+)\.([0-9]{2})/] },
  { name: '西部数码', url: 'https://www.west.cn/domain/{tld}', patterns: [/¥([0-9]+)\.([0-9]{2})/] },
  { name: '新网', url: 'https://www.xinnet.com/domain/{tld}', patterns: [/¥([0-9]+)\.([0-9]{2})/] },
  { name: '华为云', url: 'https://www.huaweicloud.com/domain/{tld}', patterns: [/¥([0-9]+)\.([0-9]{2})/] },
  { name: 'Namesilo', url: 'https://www.namesilo.com/search?searchTerm={tld}&tld={tld}', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
  { name: 'Dynadot', url: 'https://www.dynadot.com/domain/whois?domain={tld}', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
  { name: 'Spaceship', url: 'https://spaceship.com/domains/registration/{tld}', patterns: [/\$([0-9]+\.[0-9]{2})/i] },
];

// 浏览器 headers
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
};

// 生成样本域名
function generateSampleDomains(count) {
  const prefixes = [
    'test', 'example', 'demo', 'sample', 'try', 'hello', 'world',
    'quick', 'brown', 'fox', 'lazy', 'dog', 'cat', 'bird', 'fish',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
    'my', 'your', 'our', 'the', 'best', 'top', 'new', 'old',
  ];
  
  const domains = [];
  for (let i = 0; i < count; i++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    domains.push(`${prefix}${suffix}.${TLD}`);
  }
  return domains;
}

// WHOIS 查询（使用 RDAP）
async function checkWhois(domain) {
  try {
    const res = await axios.get(`https://rdap.org/domain/${domain}`, {
      headers: HEADERS,
      timeout: 15000,
    });
    // 404 = 可用
    if (res.status === 404) return 'available';
    // 200 = 已注册
    if (res.status === 200) return 'registered';
    return 'unknown';
  } catch (e) {
    // 尝试备用方法
    try {
      const res = await axios.get(`https://api.rdap.org/domain/${domain}`, {
        headers: HEADERS,
        timeout: 10000,
      });
      return res.status === 404 ? 'available' : 'registered';
    } catch {
      return 'unknown';
    }
  }
}

// 抓取单个注册商的价格
async function scrapePrice(registrar, tld) {
  const url = registrar.url.replace('{tld}', tld);
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 20000,
    });
    const text = res.data;
    
    for (const pattern of registrar.patterns) {
      const match = text.match(pattern);
      if (match) {
        let price;
        if (match[2]) {
          price = parseFloat(`${match[1]}.${match[2]}`);
        } else {
          price = parseFloat(match[1]);
        }
        if (!isNaN(price) && price > 0 && price < 1000) {
          return price;
        }
      }
    }
    return null;
  } catch (e) {
    console.log(`    Failed: ${e.message}`);
    return null;
  }
}

// 加载统计信息
function loadStats() {
  try {
    if (existsSync(STATS_FILE)) {
      return JSON.parse(readFileSync(STATS_FILE, 'utf8'));
    }
  } catch {}
  return { totalScraped: 0, lastRun: 0, results: {} };
}

// 保存统计信息
function saveStats(stats) {
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// 主函数
async function main() {
  console.log(`Starting price scraper for .${TLD}...`);
  console.log(`Sample size: ${SAMPLE_SIZE}`);
  
  // 创建输出目录
  mkdirSync(OUTPUT_DIR, { recursive: true });
  
  // 加载统计
  const stats = loadStats();
  
  // 生成样本域名
  const sampleDomains = generateSampleDomains(SAMPLE_SIZE);
  console.log(`Generated ${sampleDomains.length} sample domains`);
  
  // 记录结果
  const results = {};
  let availableCount = 0;
  let registeredCount = 0;
  let failedCount = 0;
  
  // 处理每个域名
  for (let i = 0; i < sampleDomains.length; i++) {
    const domain = sampleDomains[i];
    process.stdout.write(`\r[${i + 1}/${sampleDomains.length}] Checking ${domain}...`);
    
    // WHOIS 检查
    const whoisStatus = await checkWhois(domain);
    
    if (whoisStatus === 'registered') {
      registeredCount++;
      continue;
    }
    
    if (whoisStatus === 'unknown') {
      failedCount++;
      continue;
    }
    
    // 可用域名，记录
    availableCount++;
    results[domain] = { status: 'available', whoisChecked: true };
    
    // 抓取价格（只对可用域名）
    results[domain].prices = {};
    for (const registrar of REGISTRARS) {
      const price = await scrapePrice(registrar, TLD);
      results[domain].prices[registrar.name] = {
        price,
        success: price !== null,
      };
      // 避免请求过快
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log('\n\n=== Scrape Complete ===');
  console.log(`Total: ${sampleDomains.length}`);
  console.log(`Available: ${availableCount}`);
  console.log(`Registered: ${registeredCount}`);
  console.log(`Failed: ${failedCount}`);
  
  // 更新统计
  stats.totalScraped += availableCount;
  stats.lastRun = Date.now();
  stats.results[TLD] = results;
  
  // 保存
  writeFileSync(join(OUTPUT_DIR, `${TLD}.json`), JSON.stringify(results, null, 2));
  saveStats(stats);
  
  console.log(`Saved to ${OUTPUT_DIR}/${TLD}.json`);
}

main().catch(console.error);
