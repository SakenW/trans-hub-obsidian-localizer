import { App, Modal } from "obsidian";

import type { MarkdownExtractionResult } from "./markdown-extractor";

export class ScanResultModal extends Modal {
  constructor(
    app: App,
    private readonly filePath: string,
    private readonly result: MarkdownExtractionResult,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "语枢扫描结果" });
    contentEl.createEl("p", {
      text: `${this.filePath}：共 ${this.result.blocks.length} 个可翻译块，${this.result.readyCount} 个 ready，${this.result.unstableCount} 个 unstable。`,
      cls: "trans-hub-scan-modal__summary",
    });
    contentEl.createEl("p", {
      text: "本次仅在本地读取并分析活动笔记，没有上传或修改文档。只有唯一的显式 ^block-id 会产生可提交语义身份。",
      cls: "trans-hub-scan-modal__boundary",
    });

    if (this.result.blocks.length === 0) {
      contentEl.createEl("p", { text: "没有发现可翻译块。" });
      return;
    }

    const list = contentEl.createEl("ol", {
      cls: "trans-hub-scan-modal__list",
    });
    for (const block of this.result.blocks) {
      const item = list.createEl("li", {
        cls: "trans-hub-scan-modal__item",
      });
      item.createSpan({
        text: `${block.submissionState} · ${block.kind} · L${block.provenance.startLine}–${block.provenance.endLine}${block.blockId === null ? "" : ` · ^${block.blockId}`}`,
        cls: "trans-hub-scan-modal__meta",
      });
      item.createSpan({
        text: block.text,
        cls: "trans-hub-scan-modal__text",
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
