#!/usr/bin/env node

/**
 * Real browser screenshot test script
 * This script actually starts a browser and saves screenshot files
 */

import { chromium } from 'playwright';
import { promises as fs } from 'fs';

/**
 * Function to extract page Markdown content
 */
async function extractMarkdown(page, siteName) {
  try {
    const markdownContent = await page.evaluate(() => {
      // HTML to Markdown conversion function (simplified version, same logic as in MCP tools)
      function htmlToMarkdown(element, depth = 0) {
        let markdown = '';
        const indent = '  '.repeat(depth);
        
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim();
            if (text) {
              markdown += text + ' ';
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            const tagName = el.tagName.toLowerCase();
            
            switch (tagName) {
              case 'h1':
                markdown += `\n\n# ${el.textContent?.trim()}\n\n`;
                break;
              case 'h2':
                markdown += `\n\n## ${el.textContent?.trim()}\n\n`;
                break;
              case 'h3':
                markdown += `\n\n### ${el.textContent?.trim()}\n\n`;
                break;
              case 'p':
                const pText = htmlToMarkdown(el, depth);
                if (pText.trim()) {
                  markdown += `\n\n${pText.trim()}\n`;
                }
                break;
              case 'a':
                const href = el.getAttribute('href');
                const linkText = el.textContent?.trim();
                if (href && linkText) {
                  if (href.startsWith('http')) {
                    markdown += `[${linkText}](${href})`;
                  } else {
                    markdown += linkText;
                  }
                } else {
                  markdown += linkText || '';
                }
                break;
              case 'strong':
              case 'b':
                markdown += `**${el.textContent?.trim()}**`;
                break;
              case 'em':
              case 'i':
                markdown += `*${el.textContent?.trim()}*`;
                break;
              case 'ul':
              case 'ol':
                markdown += '\n';
                const listItems = el.querySelectorAll('li');
                listItems.forEach((li, index) => {
                  const bullet = tagName === 'ul' ? '-' : `${index + 1}.`;
                  markdown += `${indent}${bullet} ${li.textContent?.trim()}\n`;
                });
                markdown += '\n';
                break;
              case 'div':
              case 'section':
              case 'article':
              case 'main':
                markdown += htmlToMarkdown(el, depth);
                break;
              case 'script':
              case 'style':
              case 'nav':
              case 'footer':
                // Ignore these elements
                break;
              default:
                markdown += htmlToMarkdown(el, depth);
                break;
            }
          }
        }
        
        return markdown;
      }

      // Extract page content
      const title = document.title;
      const url = window.location.href;
      let content = `# ${title}\n\n**URL:** ${url}\n\n`;
      content += htmlToMarkdown(document.body);
      
      // Clean up content
      content = content
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
      
      // Limit length
      if (content.length > 2000) {
        content = content.substring(0, 2000) + '\n\n[Content truncated...]';
      }
      
      return content;
    });

    // Save Markdown content to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `markdown-${siteName}-${timestamp}.md`;
    await fs.writeFile(filename, markdownContent, 'utf8');
    
    console.log(`✅ Markdown content saved: ${filename} (${(markdownContent.length / 1024).toFixed(2)} KB)`);
    
    return { filename, content: markdownContent };
  } catch (error) {
    console.log(`⚠️ Failed to extract Markdown content for ${siteName}: ${error.message}`);
    return null;
  }
}

async function testRealScreenshot() {
  console.log('🚀 Starting real browser screenshot test...');
  
  let browser;
  
  try {
    // Launch browser
    browser = await chromium.launch({ headless: true });
    console.log('✅ Browser launched');
    
    // Create page
    const page = await browser.newPage();
    console.log('✅ Page created');
    
    // Navigate to test page
    console.log('🌐 Navigating to https://example.com...');
    await page.goto('https://example.com');
    console.log('✅ Page loaded successfully');
    
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
    
    // Extract Markdown content
    console.log('📄 Extracting page Markdown content...');
    const markdownContent = await extractMarkdown(page, 'example.com');
    
    // Take screenshot and save
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    
    console.log(`📸 Taking screenshot and saving as ${filename}...`);
    await page.screenshot({ 
      path: filename,
      fullPage: true,
      type: 'png'
    });
    
    console.log(`✅ Screenshot saved: ${filename}`);
    
    // Check if file exists
    const stats = await fs.stat(filename);
    console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`📂 File location: ${process.cwd()}/${filename}`);
    
    // Take screenshots of different websites for comparison
    const sites = [
      { url: 'https://github.com', name: 'github' }
    ];
    
          for (const site of sites) {
        try {
          console.log(`🌐 Visiting ${site.url}...`);
          await page.goto(site.url);
          await page.waitForLoadState('networkidle');
          
          // Extract Markdown content
          console.log(`📄 Extracting Markdown content for ${site.name}...`);
          await extractMarkdown(page, site.name);
          
          const siteFilename = `screenshot-${site.name}-${timestamp}.png`;
          await page.screenshot({ 
            path: siteFilename,
            fullPage: false, // Only capture viewport area, faster
            type: 'png'
          });
          
          const siteStats = await fs.stat(siteFilename);
          console.log(`✅ ${site.name} screenshot saved: ${siteFilename} (${(siteStats.size / 1024).toFixed(2)} KB)`);
          
        } catch (error) {
          console.log(`⚠️ ${site.name} processing failed: ${error.message}`);
        }
      }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('🛑 Browser closed');
    }
  }
}

// Run test
testRealScreenshot().catch(console.error); 