const {test}=require('node:test');const assert=require('node:assert/strict');
const {formatTaxiAddress,taxiPresenceNote,presentTaxiPoint}=require('./presentation');
test('all taxi display labels omit redundant country and region without changing source data',()=>{
 const point={address:'Россия, Приморский край, Владивосток, Пограничная улица, 15В',lat:43.12,lon:131.88};
 const shown=presentTaxiPoint(point);
 assert.equal(shown.address,'Владивосток, Пограничная улица, 15В');
 assert.equal(shown.lat,point.lat);assert.equal(shown.lon,point.lon);
 assert.equal(point.address,'Россия, Приморский край, Владивосток, Пограничная улица, 15В');
 assert.equal(formatTaxiAddress('Приморский край, Владивосток, улица Толстого, 23'),'Владивосток, улица Толстого, 23');
 assert.equal(formatTaxiAddress('Российская Федерация, ПРИМОРСКИЙ КРАЙ, Артём, улица Ленина, 2/1'),'Артём, улица Ленина, 2/1');
 assert.equal(presentTaxiPoint(undefined),undefined);
});
test('formatting preserves city, street and other regions and shortens presence before truncating',()=>{
 assert.equal(formatTaxiAddress('Россия, Московская область, Химки, улица Россия, 12'),'Московская область, Химки, улица Россия, 12');
 assert.equal(formatTaxiAddress('Владивосток, Приморский край, 12'),'Владивосток, Приморский край, 12');
 assert.equal(taxiPresenceNote('Клиент','Россия, Приморский край, Владивосток, улица Нейбута, 33А'),'Клиент · Владивосток, улица Нейбута, 33А');
 assert.equal(formatTaxiAddress(undefined),'');
 assert.ok(taxiPresenceNote('Клиент','Адрес '.repeat(40)).length<=100);
});
