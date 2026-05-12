/**
 * Skills Manager — system prompt injection for chat.qwen.ai
 *
 * Skills are .md/.txt files stored in ~/.config/qwen-studio/skills/.
 * Each skill contains a system prompt that gets injected into the chat input
 * when selected from the Skills menu.
 *
 * Key features:
 * - injectSkill() injects via executeJavaScript with React nativeInputValueSetter
 *   pattern, plus MutationObserver fallback for late-rendered inputs
 * - buildSkillsMenuTemplate() returns menu items for pre-build inclusion
 *   (avoids Electron's immutable post-build menu issue)
 */

import { app, dialog, shell, MenuItemConstructorOptions } from "electron";
import * as fs from "fs";
import * as path from "path";

/** Directory where user skills are stored (platform-dependent via app.getPath) */
const SKILLS_DIR = path.join(app.getPath("userData"), "skills");

/**
 * Ordered DOM selectors tried when locating the chat input element.
 * Falls back through these in order until one matches.
 */
const INPUT_SELECTORS = [
  'textarea[data-id="chat-input"]',
  "textarea[placeholder]",
  "textarea",
  'div[contenteditable="true"]',
  '[data-testid="chat-input"]',
  'textarea[id*="chat"]',
  'div[role="textbox"]',
];

/**
 * Ensure the skills directory exists, creating it and a sample skill if absent.
 */
export function ensureSkillsDir(): void {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const sampleSkill =
      "# Python Expert\n\nAct as a senior Python developer. Focus on PEP8, efficiency, and best practices.";
    fs.writeFileSync(path.join(SKILLS_DIR, "python-expert.md"), sampleSkill);
  }
}

/**
 * Return the filenames of all available skills (*.md or *.txt).
 */
export async function getAvailableSkills(): Promise<string[]> {
  ensureSkillsDir();
  try {
    const files = await fs.promises.readdir(SKILLS_DIR);
    return files.filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  } catch (error) {
    console.error("[Skills] Error reading skills dir:", error);
    return [];
  }
}

/**
 * Read a skill file and inject its content into the chat input of the main
 * window. Handles both plain textareas and React-controlled inputs via the
 * nativeInputValueSetter pattern, as well as contenteditable divs. Falls back
 * to a MutationObserver that retries for up to 3 seconds if no element is
 * found on the first pass.
 */
export async function injectSkill(
  skillName: string,
  getMainWindow: () => Electron.BrowserWindow | null,
): Promise<void> {
  const win = getMainWindow();
  if (!win) return;

  const skillPath = path.join(SKILLS_DIR, skillName);
  let content: string;
  try {
    content = await fs.promises.readFile(skillPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Skills] Failed to read ${skillName}:`, err);
    dialog.showErrorBox(
      "Skill Error",
      `Failed to load skill: ${skillName}\n\nError: ${msg}\nDir: ${SKILLS_DIR}`,
    );
    return;
  }

  const jsCode = `
    (function() {
      var text = ${JSON.stringify(content)};
      var selectors = ${JSON.stringify(INPUT_SELECTORS)};

      function findElement() {
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) return el;
        }
        return null;
      }

      function setTextareaValue(el, text) {
        /* React-controlled input: use nativeInputValueSetter */
        var valueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        if (valueSetter) {
          var existing = el.value || '';
          valueSetter.call(el, text + existing);
        } else {
          el.value = text + (el.value || '');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.focus();
      }

      function setContentEditable(el, text) {
        el.textContent = text + (el.textContent || '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
      }

      function fillElement(el) {
        if (!el) return false;
        var tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          setTextareaValue(el, text);
        } else if (el.getAttribute('contenteditable') === 'true' || tag === 'DIV') {
          setContentEditable(el, text);
        } else {
          /* best-effort fallback */
          setTextareaValue(el, text);
        }
        console.log('[Skills] Injected skill into:', el.tagName, el.className);
        return true;
      }

      /* Try immediately */
      var el = findElement();
      if (fillElement(el)) return;

      /* Fallback: observe DOM mutations for up to 3 seconds */
      var observer = new MutationObserver(function(mutations, obs) {
        var found = findElement();
        if (found && fillElement(found)) {
          obs.disconnect();
        }
      });

      var timeout = setTimeout(function() {
        observer.disconnect();
        console.warn('[Skills] Could not find chat input element after 3s');
      }, 3000);

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      /* Clear timeout if we succeed before then */
      var origDisconnect = observer.disconnect.bind(observer);
      observer.disconnect = function() {
        clearTimeout(timeout);
        origDisconnect();
      };
    })();
  `;

  try {
    await win.webContents.executeJavaScript(jsCode);
    console.log(`[Skills] Injected: ${skillName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Skills] Failed to inject ${skillName}:`, err);
    dialog.showErrorBox(
      "Skill Error",
      `Failed to inject skill: ${skillName}\n\nError: ${msg}`,
    );
  }
}

/**
 * Open the skills directory in the system file manager.
 */
export function openSkillsFolder(
  getMainWindow: () => Electron.BrowserWindow | null,
): void {
  ensureSkillsDir();
  shell.openPath(SKILLS_DIR);
}

/**
 * Build the menu-item template for the Skills submenu. Returns an array of
 * MenuItemConstructorOptions that should be spread into the submenu template
 * at menu-build time — avoiding the bug of mutating Electron menus after
 * Menu.buildFromTemplate().
 */
export async function buildSkillsMenuTemplate(
  getMainWindow: () => Electron.BrowserWindow | null,
): Promise<MenuItemConstructorOptions[]> {
  const skills = await getAvailableSkills();

  const items: MenuItemConstructorOptions[] = [
    {
      label: "Open Skills Folder",
      click: () => openSkillsFolder(getMainWindow),
    },
    { type: "separator" },
  ];

  if (skills.length === 0) {
    items.push({ label: "No skills available", enabled: false });
  } else {
    for (const skill of skills) {
      items.push({
        label: skill.replace(/\.md$/, "").replace(/\.txt$/, ""),
        click: () => injectSkill(skill, getMainWindow),
      });
    }
  }

  return items;
}
