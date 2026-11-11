const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activeBindings, replyContext } = require('./multi-ticket');
const { decideAttach } = require('./rules');
const tickets = [{_id:'one',num:1},{_id:'two',num:2}];
test('legacy binding remains readable, explicit multi-ticket state supersedes it', () => {
  assert.equal(activeBindings({binding:{ticketId:'one'}}).length, 1);
  assert.deepEqual(activeBindings({binding:{ticketId:'one'},ticketBindings:[]}), []);
});
test('multiple open linked tickets require a quote or manual resolution', () => {
  const conversation = {kind:'direct',ticketBindings:tickets.map(t=>({ticketId:t._id}))};
  const message = {direction:'in',origin:'client'};
  assert.equal(decideAttach({conversation,message,linkedTickets:tickets}).ticketId,null);
  assert.equal(decideAttach({conversation,message,linkedTickets:tickets,replyToTicket:tickets[1]}).ticketId,'two');
  assert.equal(decideAttach({conversation,message,linkedTickets:tickets,replyToTicket:{_id:'foreign',num:3}}).ticketId,null);
  assert.equal(decideAttach({conversation,message,linkedTickets:[tickets[1]]}).ticketId,'two');
});
test('reply contexts expire after thirty minutes and invalid saved selection requires a new choice', () => {
  const now = new Date('2026-11-11T10:00:00Z');
  assert.equal(replyContext({tickets,now}).required,true);
  assert.equal(replyContext({tickets:[tickets[0]],now}).ticketId,'one');
  assert.equal(replyContext({tickets, saved:{withoutTicket:true,expiresAt:'2026-11-11T10:01:00Z'},now}).withoutTicket,true);
  assert.equal(replyContext({tickets, saved:{ticketId:'one',expiresAt:now},now}).required,true);
  assert.equal(replyContext({tickets, saved:{ticketId:'one',expiresAt:now},now}).expiresAt,now);
  assert.equal(replyContext({tickets:[tickets[1]], saved:{ticketId:'one',expiresAt:'2026-11-11T10:01:00Z'},now}).required,true);
});

test('an ended canonical binding retains the legacy post-close decision prompt', () => {
  const endedAt = new Date('2026-11-11T09:00:00Z');
  const binding = {ticketId:'one',ticketNum:1,endedAt,endReason:'closed'};
  const result = decideAttach({conversation:{kind:'direct',binding,ticketBindings:[binding]},message:{direction:'in',origin:'client',sentAt:new Date('2026-11-11T09:05:00Z')},linkedTickets:[]});
  assert.deepEqual(result.decision,{ticketId:'one',ticketNum:1});
  assert.equal(result.mode,null);
});

test('quoting a closed or unlinked ticket never falls through into the sole unrelated open ticket', () => {
  const conversation={kind:'direct',ticketBindings:[{ticketId:'one',endedAt:new Date()},{ticketId:'two'}]};
  const message={direction:'in',origin:'client'};
  for(const quoted of [{_id:'one',num:1,isClosed:true},{_id:'foreign',num:8}]){
    const verdict=decideAttach({conversation,message,linkedTickets:[tickets[1]],replyToTicket:quoted});
    assert.equal(verdict.ticketId,null);assert.equal(verdict.suggestTicketId,quoted._id);
  }
});

test('after several closures the decision refers to the most recently ended canonical link', () => {
 const first={ticketId:'one',ticketNum:1,endedAt:new Date('2026-11-11T09:00:00Z'),endReason:'closed'};
 const second={ticketId:'two',ticketNum:2,endedAt:new Date('2026-11-11T09:10:00Z'),endReason:'closed'};
 const verdict=decideAttach({conversation:{kind:'direct',binding:first,ticketBindings:[first,second]},message:{direction:'in',origin:'client',sentAt:new Date('2026-11-11T09:15:00Z')},linkedTickets:[]});
 assert.deepEqual(verdict.decision,{ticketId:'two',ticketNum:2});
});

test('declining the latest closure does not resurrect an earlier closed-ticket prompt', () => {
 const first={ticketId:'one',ticketNum:1,endedAt:new Date('2026-11-11T09:00:00Z'),endReason:'closed'};
 const last={ticketId:'two',ticketNum:2,endedAt:new Date('2026-11-11T09:10:00Z'),endReason:'manual'};
 const verdict=decideAttach({conversation:{kind:'direct',binding:first,ticketBindings:[first,last]},message:{direction:'in',origin:'client',sentAt:new Date('2026-11-11T09:15:00Z')},linkedTickets:[]});
 assert.equal(verdict.decision,undefined);
});
