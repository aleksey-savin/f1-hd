require('module-alias/register');
const { test }=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const id=require.resolve('@/models/message'),entry=new Module(id);
let source;
Object.assign(entry,{loaded:true,exports:{findById:()=>({lean:async()=>source})}});require.cache[id]=entry;
const {validateReplyReference}=require('./reply-reference');
const conversation={_id:'chat'};
const channel={provider:'wazzup'};
const messageId='64f600000000000000000003';
test('a native reply resolves only a live message from the same conversation',async()=>{
 source={_id:messageId,conversationId:'chat',externalId:'provider-msg',direction:'in'};
 assert.deepEqual(await validateReplyReference({conversation,channel,replyToId:messageId}),{replyToId:messageId,replyToExternalId:'provider-msg'});
 source.conversationId='foreign';await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId}),/не найдено/);
 source.conversationId='chat';source.deletedAt=new Date();await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId}),/недоступно/);
});
test('unsupported transports and unconfirmed or system messages cannot produce fake native replies',async()=>{
 source={_id:messageId,conversationId:'chat',direction:'out'};
 await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId}),/доставки/);
 source.externalId='external';source.direction='system';await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId}),/недоступно/);
 await assert.rejects(validateReplyReference({conversation,channel:{provider:'gateway'},replyToId:messageId}),/не поддерживает/);
 assert.deepEqual(await validateReplyReference({conversation,channel}),{});
});

test('same-chat quote cannot reveal a foreign ticket or free message',async()=>{
 const auth={userId:'staff',can:r=>r.conversation.every(v=>v==='read'),messagingScope:{ticketIds:['own']}};
 source={_id:messageId,conversationId:'chat',externalId:'provider',direction:'in',ticketId:'foreign'};
 await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId,auth}),/не найдено/);
 source.ticketId=null;
 await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId,auth}),/не найдено/);
 source.ticketId='own';
 assert.equal((await validateReplyReference({conversation,channel,replyToId:messageId,auth})).replyToExternalId,'provider');
});
test('only the owner may quote a free discussion and remapping removes that permission',async()=>{
 const auth={userId:'staff',can:r=>r.conversation.every(v=>v==='read'),messagingScope:{ticketIds:[]}};
 source={_id:messageId,conversationId:'chat',externalId:'provider',direction:'in',ticketId:null,attachMode:'free',discussionUserId:'staff'};
 assert.equal((await validateReplyReference({conversation,channel,replyToId:messageId,auth})).replyToExternalId,'provider');
 source.discussionUserId='other';await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId,auth}),/не найдено/);
 source.discussionUserId='staff';source.ticketId='foreign';await assert.rejects(validateReplyReference({conversation,channel,replyToId:messageId,auth}),/не найдено/);
});
