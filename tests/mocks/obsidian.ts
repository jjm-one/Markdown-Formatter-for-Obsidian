// SPDX-License-Identifier: LGPL-3.0-only
// `moment` is a hard dependency of the real `obsidian` package, which re-exports it.
export { default as moment } from "moment";

export class TAbstractFile {
  path: string;
  constructor(path = "") {
    this.path = path;
  }
}

export class TFile extends TAbstractFile {
  name: string;
  extension: string;
  constructor(path = "note.md") {
    super(path);
    this.name = path.split("/").at(-1) ?? path;
    this.extension = this.name.includes(".") ? (this.name.split(".").at(-1) ?? "") : "";
  }
}

export class FileSystemAdapter {
  constructor(private basePath = "/vault") {}
  getBasePath() {
    return this.basePath;
  }
}

export class MarkdownView {
  constructor(public file: TFile | null = null) {}
}

export class Notice {
  static messages: string[] = [];
  constructor(public message: string) {
    Notice.messages.push(message);
  }
}

export class Plugin {
  app: any;
  private data: any = null;
  commands: any[] = [];
  events: any[] = [];
  settingTabs: any[] = [];
  ribbons: any[] = [];
  domEvents: Array<{ el: any; type: string; cb: (event?: any) => any }> = [];

  constructor(app?: any) {
    this.app = app;
  }
  async loadData() {
    return await Promise.resolve(this.data);
  }
  async saveData(data: any) {
    this.data = await Promise.resolve(data);
  }
  addCommand(command: any) {
    this.commands.push(command);
    return command;
  }
  registerEvent(event: any) {
    this.events.push(event);
    return event;
  }
  registerDomEvent(el: any, type: string, cb: (event?: any) => any) {
    this.domEvents.push({ el, type, cb });
  }
  addSettingTab(tab: any) {
    this.settingTabs.push(tab);
  }
  addRibbonIcon(icon: string, title: string, callback: () => void) {
    const element = {
      icon,
      title,
      callback,
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    this.ribbons.push(element);
    return element as any;
  }
}

export class PluginSettingTab {
  containerEl: any = createElement();
  updateCount = 0;
  refreshDomStateCount = 0;
  constructor(
    public app: any,
    public plugin: any,
  ) {}
  update() {
    this.updateCount += 1;
  }
  refreshDomState() {
    this.refreshDomStateCount += 1;
  }
}

function createElement(): any {
  return {
    children: [] as any[],
    empty() {
      this.children = [];
    },
    addClass() {},
    createEl(_tag: string, options?: any) {
      const el = createElement();
      el.text = options?.text ?? "";
      el.value = "";
      el.setText = (value: string) => {
        el.value = value;
        return el;
      };
      el.addEventListener = () => {};
      this.children.push(el);
      return el;
    },
    querySelector() {
      return null;
    },
  };
}

class ComponentBuilder {
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addToggle(callback: any) {
    callback({
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addText(callback: any) {
    callback({
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  addButton(callback: any) {
    callback({
      setButtonText() {
        return this;
      },
      onClick() {
        return this;
      },
    });
    return this;
  }
  addDropdown(callback: any) {
    callback({
      addOption() {
        return this;
      },
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    });
    return this;
  }
  controlEl: any = createElement();
}

export class Setting extends ComponentBuilder {
  constructor(container: any) {
    super();
    void container;
  }
}

export class App {}
