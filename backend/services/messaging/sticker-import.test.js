const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseSetName, createImporter } = require("./sticker-import");
test("only Telegram sticker-set links or names are accepted", () => {
  assert.equal(parseSetName("https://t.me/addstickers/SupportStickers"), "SupportStickers");
  assert.equal(parseSetName("SupportStickers"), "SupportStickers");
  for (const value of [
    "https://evil.test/addstickers/SupportStickers",
    "https://t.me@evil.test/addstickers/SupportStickers",
    "../secret",
    "https://t.me/addstickers/SupportStickers?x=1",
  ])
    assert.throws(() => parseSetName(value));
});
test("repeat import reuses catalogue entries and rejects animation before download", async () => {
  const records = new Map();
  let writes = 0,
    downloads = 0;
  let set = {
    name: "SupportStickers",
    title: "SupportStickers",
    stickers: [
      {
        file_id: "f",
        file_unique_id: "u",
        type: "regular",
        is_animated: false,
        is_video: false,
      },
    ],
  };
  const run = createImporter({
    getSet: async () => set,
    download: async () => {
      downloads++;
      return Buffer.from("webp");
    },
    validate: () => {},
    find: async (key) => records.get(key),
    put: async () => ({ name: `stored-${++writes}`, size: 4 }),
    save: async (key, fields) => {
      records.set(key, { ...fields });
      return fields;
    },
    remove: async () => {},
  });
  assert.equal((await run("SupportStickers")).count, 1);
  await run("https://t.me/addstickers/SupportStickers");
  assert.equal(writes, 1);
  assert.equal(downloads, 1);
  set.stickers.push({
    file_id: "animated",
    file_unique_id: "a",
    is_animated: true,
  });
  await assert.rejects(run("SupportStickers"), /статич/);
  assert.equal(downloads, 1);
});
test('download failure does not publish a partial new pack',async()=>{
 let saved=0;
 const run=createImporter({getSet:async()=>({stickers:[{file_id:'a',file_unique_id:'a',type:'regular'},{file_id:'b',file_unique_id:'b',type:'regular'}]}),find:async()=>null,download:async s=>{if(s.file_id==='b')throw Error('offline');return Buffer.from('a')},validate:()=>{},put:async()=>{saved++;},save:async()=>{},remove:async()=>{}});
 await assert.rejects(run('SupportStickers'),/offline/);assert.equal(saved,0);
});
test('telegram client sanitizes upstream errors that may contain the token',async()=>{
 const {telegramClient}=require('./sticker-import');
 const client=telegramClient('secret-token',async()=>{throw Error('https://api.telegram.org/botsecret-token/getStickerSet')});
 await assert.rejects(client.getSet('SupportStickers'),error=>!error.message.includes('secret-token')&&error.statusCode===502);
});
test('switches the single pack only after all files and records are ready',async()=>{
 let pack={name:'Old',keys:['old']};let failSave=true;
 const run=createImporter({getSet:async()=>({title:'New',stickers:[{file_id:'f',file_unique_id:'u',type:'regular'}]}),find:async()=>null,download:async()=>Buffer.from('data'),validate:()=>{},put:async()=>({name:'new.webp'}),save:async(_,fields)=>{if(failSave)throw Error('database');return fields},remove:async()=>{},publish:async value=>{pack=value}});
 await assert.rejects(run('New'),/database/);assert.equal(pack.name,'Old');
 failSave=false;await run('New');assert.equal(pack.name,'New');assert.deepEqual(pack.keys,['telegram:new:u']);
});
