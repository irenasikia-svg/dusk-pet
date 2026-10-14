// JXA：把文件放进剪贴板，切到 Claude 并粘贴到当前输入框，随后还原原剪贴板
// osascript -l JavaScript paste-to-claude.js /path/a /path/b
ObjC.import('AppKit');

function backup(pb) {
  const saved = [];
  const items = pb.pasteboardItems;
  if (!items || items.isNil()) return saved;
  for (let i = 0; i < items.count; i++) {
    const item = items.objectAtIndex(i);
    const copy = $.NSPasteboardItem.alloc.init;
    const types = item.types;
    for (let j = 0; j < types.count; j++) {
      const type = types.objectAtIndex(j);
      const data = item.dataForType(type);
      if (!data.isNil()) copy.setDataForType(data, type);
    }
    saved.push(copy);
  }
  return saved;
}

function run(argv) {
  if (!argv.length) return 'no files';
  const pb = $.NSPasteboard.generalPasteboard;
  const saved = backup(pb);

  pb.clearContents;
  const urls = $.NSMutableArray.array;
  argv.forEach((p) => urls.addObject($.NSURL.fileURLWithPath(p)));
  pb.writeObjects(urls);

  const claude = Application('Claude');
  claude.activate();
  delay(0.6);
  Application('System Events').keystroke('v', { using: 'command down' });
  delay(1.5);

  pb.clearContents;
  if (saved.length) pb.writeObjects($(saved));
  return 'ok';
}
