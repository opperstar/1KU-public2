"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  advancedSchema: () => advancedSchema,
  authSchema: () => authSchema,
  businessFactory: () => businessFactory,
  callbackSchema: () => callbackSchema,
  demoFormSchema: () => demoFormSchema,
  parse: () => parse,
  probe: () => probe,
  productFormSchema: () => productFormSchema,
  productSchema: () => productSchema,
  profileSchema: () => profileSchema,
  stepSchemas: () => stepSchemas,
  tableParse: () => tableParse,
  userSchema: () => userSchema
});
module.exports = __toCommonJS(stdin_exports);
var v = __toESM(require("valibot"));

// qualification:frozen
var SOURCE_MESSAGES = { "templateUi9654ce026d95": "\u59D3\u540D\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26", "templateUi4eaf1d802905": "\u90AE\u7BB1\u5730\u5740\u65E0\u6548", "templateUic880e885f242": "\u5E74\u9F84\u5FC5\u987B\u81F3\u5C11\u4E3A 18 \u5C81", "templateUie3b8d09d1ac4": "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 8 \u4E2A\u5B57\u7B26", "templateUi4a155eecf083": "\u7535\u8BDD\u53F7\u7801\u81F3\u5C11\u9700\u8981 10 \u4F4D\u6570\u5B57", "templateUi82e45382e7d6": "URL \u65E0\u6548", "templateUi4aa3d5bc592a": "\u4E2A\u4EBA\u7B80\u4ECB\u81F3\u5C11\u9700\u8981 10 \u4E2A\u5B57\u7B26", "templateUic6e556cc054d": "\u8BF7\u9009\u62E9\u56FD\u5BB6", "templateUi40984c01028e": "\u8BF7\u9009\u62E9\u6846\u67B6", "templateUif7d0e92d2cdb": "\u81F3\u5C11\u9009\u62E9\u4E00\u9879\u5174\u8DA3", "templateUi28ef2fc8c34c": "\u8BF7\u9009\u62E9\u6027\u522B", "templateUice04943fc4d4": "\u8BF7\u8F93\u5165 6 \u4F4D\u6570\u5B57", "templateUi91c514bd1a1f": "\u81F3\u5C11\u6DFB\u52A0\u4E00\u4E2A\u6807\u7B7E", "templateUic26135d75f4d": "\u5FC5\u987B\u63A5\u53D7\u6761\u6B3E", "templateUi2753dd23cf7b": "\u8BF7\u8F93\u5165\u6210\u5458\u59D3\u540D", "templateUi4bd52bf1428b": "\u8BF7\u9009\u62E9\u89D2\u8272", "templateUi7839f4b65786": "\u81F3\u5C11\u6DFB\u52A0\u4E00\u540D\u6210\u5458", "templateUic9e6375bffd3": "\u9009\u62E9\u56FD\u5BB6\u6216\u5730\u533A", "templateUib058fc7c5e0b": "\u8BF7\u9009\u62E9\u5DDE/\u5730\u533A", "templateUi6e697b26cc1d": "\u4EA7\u54C1\u540D\u79F0\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26", "templateUi91af1745f302": "\u8BF7\u9009\u62E9\u5206\u7C7B", "templateUi1e13d464e26a": "\u4EF7\u683C\u5FC5\u987B\u5927\u4E8E 0", "templateUiea333665d697": "\u63CF\u8FF0\u81F3\u5C11\u9700\u8981 10 \u4E2A\u5B57\u7B26", "templateUic20ffba2f530": "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u90AE\u7BB1\u5730\u5740", "templateUi2cec699634f9": "\u5FC5\u987B\u4E0A\u4F20\u56FE\u7247\u3002", "templateUif3aa5b3442e0": "\u6587\u4EF6\u5927\u5C0F\u4E0D\u80FD\u8D85\u8FC7 5MB\u3002", "templateUi92ff8142c3b9": "\u652F\u6301 .jpg\u3001.jpeg\u3001.png \u548C .webp \u6587\u4EF6\u3002", "templateUi4c4af1b09084": "\u8BF7\u8F93\u5165\u4EF7\u683C", "templateUi634229800d4c": "\u5F00\u59CB\u65E5\u671F\u683C\u5F0F\u5E94\u4E3A YYYY-MM-DD", "templateUi844f85466ca3": "\u7ED3\u675F\u65E5\u671F\u683C\u5F0F\u5E94\u4E3A YYYY-MM-DD", "templateUi8094f16e79e7": "\u4EA7\u54C1\u540D\u79F0\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26\u3002", "templateUicc72a90bfea4": "\u63CF\u8FF0\u81F3\u5C11\u9700\u8981 10 \u4E2A\u5B57\u7B26\u3002", "templateUicb185b39c95f": "\u540D\u5B57\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26", "templateUi5b0c344ab484": "\u59D3\u6C0F\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26", "templateUi845babfef685": "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u90AE\u7BB1", "templateUibebb152dbd4e": "\u8BF7\u8F93\u5165\u7535\u8BDD\u53F7\u7801", "templateUi7d4ca5347fb8": "\u8BF7\u9009\u62E9\u89D2\u8272", "templateUi4fa5e448473f": "\u8BF7\u9009\u62E9\u72B6\u6001", "templateUi8033ac1b74f8": "\u4EA7\u54C1\u540D\u79F0\u81F3\u5C11\u9700\u8981 3 \u4E2A\u5B57\u7B26", "templateUi2eaecb3d0cf1": "\u5305\u542B", "templateUi56fe07f0e32e": "\u4E0D\u5305\u542B", "templateUif5985de1fd3a": "\u662F", "templateUiaaf8d683ab15": "\u4E0D\u662F", "templateUif92b47704f75": "\u4E3A\u7A7A", "templateUia043c15c8397": "\u4E0D\u4E3A\u7A7A", "templateUi11e1bbf54a9c": "\u5C0F\u4E8E", "templateUic8479b36c751": "\u5C0F\u4E8E\u6216\u7B49\u4E8E", "templateUi06684545a5cf": "\u5927\u4E8E", "templateUiaee3fdd3e23d": "\u5927\u4E8E\u6216\u7B49\u4E8E", "templateUib056c35ac271": "\u4ECB\u4E8E", "templateUi2d39ae820390": "\u65E9\u4E8E", "templateUi1c545c12a6d1": "\u665A\u4E8E", "templateUi74840924250c": "\u5F53\u5929\u6216\u4E4B\u524D", "templateUi6a481f22364e": "\u5F53\u5929\u6216\u4E4B\u540E", "templateUidd28b1656678": "\u76F8\u5BF9\u4E8E\u4ECA\u5929", "templateUicf9995d1b966": "\u5305\u542B\u4EFB\u610F\u4E00\u4E2A", "templateUi9c5ed7ff2638": "\u4E0D\u5305\u542B\u4EFB\u4F55\u4E00\u4E2A", "templateUicddeba5cfc9a": "\u5347\u5E8F", "templateUi5c4419a6999d": "\u964D\u5E8F", "templateUi49dca65f362f": "\u7F8E\u56FD", "templateUibe55ef3f4c4e": "\u52A0\u62FF\u5927", "templateUi8d23a6e37e0a": "\u82F1\u56FD", "templateUic1ef40ce0484": "\u6FB3\u5927\u5229\u4E9A", "templateUi80db4ccdca10": "\u5FB7\u56FD", "templateUi7a1ca4ef7515": "\u6CD5\u56FD", "templateUi30b7f8482c4f": "Next.js", "templateUif84ed4375595": "Remix", "templateUic490cce12748": "Astro", "templateUie88c87da3c8c": "Nuxt", "templateUib62200b334af": "SvelteKit", "templateUie790528b3879": "Angular", "templateUi3169ce6442ac": "\u79D1\u6280", "templateUi9b1f5daf0a3d": "\u8FD0\u52A8", "templateUi6eb00b4b2614": "\u97F3\u4E50", "templateUid2b98fb53714": "\u65C5\u884C", "templateUid3bdb65e5d82": "\u70F9\u996A", "templateUi463816d07097": "\u9605\u8BFB", "templateUi03f8c1273e3d": "\u7537", "templateUie8cca808ae5a": "\u5973", "templateUif97e9da0e3b8": "\u5176\u4ED6", "templateUi51fcc57e9bf9": "\u4E0D\u613F\u900F\u9732", "templateUi7f55382219f0": "\u641C\u7D22\u2026", "templateUi9697e0ec7e98": "\u672A\u627E\u5230\u6846\u67B6\u3002", "templateUi368208aaf092": "\u8F93\u5165\u5185\u5BB9\u5E76\u6309 Enter\u2026", "templateUi9fd728c66c9a": "\u6DFB\u52A0", "templateUie56e32b74e7f": "\u6240\u6709\u8868\u5355\u8F93\u5165\u63A7\u4EF6\u6F14\u793A", "templateUi57d819951496": "\u5B8C\u6574\u8868\u5355\u8F93\u5165\u63A7\u4EF6\u6F14\u793A\u2014\u2014\u4F7F\u7528 TanStack Form + shadcn/ui \u6784\u5EFA", "templateUi1b9d143f6607": "\u6587\u672C\u8F93\u5165", "templateUi8e00cdf71fa7": "\u59D3\u540D", "templateUi6cea57c2fb6c": "John Doe", "templateUi969ccbd3cf63": "\u7535\u5B50\u90AE\u7BB1", "templateUi855f96e983f1": "john@example.com", "templateUie7cf3ef4f17c": "\u5BC6\u7801", "templateUie4e54a0028c8": "\u81F3\u5C11 8 \u4E2A\u5B57\u7B26", "templateUi39b7370f30a3": "\u5E74\u9F84", "templateUi63dceb8800b2": "\u7535\u8BDD", "templateUib5a229ac8bec": "\u7F51\u7AD9", "templateUi100680ad546c": "https://example.com", "templateUi3933b1802161": "\u4E2A\u4EBA\u7B80\u4ECB", "templateUi697f10251d5b": "\u4ECB\u7ECD\u4E00\u4E0B\u4F60\u81EA\u5DF1\u2026", "templateUie1629db84d62": "\u9009\u62E9\u4E0E\u7EC4\u5408\u6846", "templateUi701d021d08c5": "\u56FD\u5BB6", "templateUic0c4f2c6659d": "\u9009\u62E9\u4F60\u7684\u56FD\u5BB6\u6216\u5730\u533A", "templateUi74aab6fdb4a6": "\u6846\u67B6 *", "templateUi2bbc9b40386c": "\u53EF\u641C\u7D22\u4E0B\u62C9\u6846", "templateUi6a59e4a9a645": "\u590D\u9009\u6846\u4E0E\u5355\u9009\u6846", "templateUic6a8f076d1b9": "\u5174\u8DA3 *", "templateUi10d20e340181": "\u9009\u62E9\u6240\u6709\u9002\u7528\u9879", "templateUia04630ef8bc3": "\u6027\u522B", "templateUi1c72280c5613": "\u5207\u6362\u6309\u94AE\u4E0E\u5F00\u5173", "templateUib083195b27be": "\u8BA2\u9605\u65B0\u95FB\u901A\u8BAF", "templateUid1b526cbf057": "\u63A5\u6536\u65B0\u529F\u80FD\u548C\u4EA7\u54C1\u66F4\u65B0", "templateUi11e9ee795aa7": "\u6587\u672C\u683C\u5F0F", "templateUi94fee62e68e2": "\u7C97\u4F53", "templateUi9bf37cb58a69": "\u659C\u4F53", "templateUi02f843261112": "\u4E0B\u5212\u7EBF", "templateUi05a921401c1b": "\u591A\u9009\u5207\u6362\u7EC4", "templateUibda2ae491b3a": "\u6211\u540C\u610F\u6761\u6B3E\u548C\u6761\u4EF6 *", "templateUi14f34284b054": "\u6ED1\u5757", "templateUi4735833efb73": "\u603B\u4F53\u8BC4\u5206", "templateUi6a5382ac3b9e": "\u8BF7\u4E3A\u4F53\u9A8C\u8BC4\u5206\uFF080-10\uFF09", "templateUia217562db538": "\u65E5\u671F\u4E0E\u65F6\u95F4", "templateUid6e62e655e83": "\u51FA\u751F\u65E5\u671F", "templateUi29241ab2d244": "\u9009\u62E9\u65E5\u671F", "templateUib90a0dec024b": "\u4E8B\u4EF6\u65F6\u95F4", "templateUi14d74158a8d1": "\u65E5\u671F\u8303\u56F4", "templateUifceaa2d70591": "\u9009\u62E9\u65E5\u671F\u8303\u56F4", "templateUia171c2728229": "\u7279\u6B8A\u8F93\u5165", "templateUif0610aa1ab76": "\u9A8C\u8BC1\u7801 *", "templateUi14a37736d02a": "6 \u4F4D OTP \u8F93\u5165", "templateUi48868738e9a0": "\u559C\u6B22\u7684\u989C\u8272", "templateUifa66a8d33124": "\u559C\u6B22\u7684\u989C\u8272", "templateUif69a50dcdb95": "\u539F\u751F\u5341\u516D\u8FDB\u5236\u989C\u8272\u9009\u62E9\u5668", "templateUi889a1541f750": "\u6807\u7B7E *", "templateUif656c85df76c": "\u6309 Enter \u6216\u70B9\u51FB\u201C\u6DFB\u52A0\u201D\u521B\u5EFA\u6807\u7B7E", "templateUi2f97c64ecffa": "\u6587\u4EF6\u4E0A\u4F20", "templateUi53f0a0b894ad": "\u5934\u50CF", "templateUi648a4eab7d90": "\u62D6\u653E\u6216\u70B9\u51FB\u4E0A\u4F20\uFF08\u6700\u5927 5MB\uFF09", "templateUidaee7606b339": "\u91CD\u7F6E", "templateUi1a42336e51c0": "\u63D0\u4EA4\u8868\u5355", "templateUicadc85dcf5f8": "\u8868\u5355\u6570\u636E\u9884\u89C8", "templateUicad0535decc3": "\u52A0\u5229\u798F\u5C3C\u4E9A\u5DDE", "templateUi815eca977c7d": "\u7EBD\u7EA6\u5DDE", "templateUi4b95ce627201": "\u5F97\u514B\u8428\u65AF\u5DDE", "templateUiecc0e7dc084f": "\u4F26\u6566", "templateUi5e02dadaa7e4": "\u66FC\u5F7B\u65AF\u7279", "templateUi810c069040f6": "\u4F2F\u660E\u7FF0", "templateUi38088e7f3ae2": "\u65B0\u5357\u5A01\u5C14\u58EB\u5DDE", "templateUic7a11e9a55de": "\u7EF4\u591A\u5229\u4E9A\u5DDE", "templateUibeee2712f137": "\u6606\u58EB\u5170\u5DDE", "templateUi3f0c576801ea": "\u56E2\u961F\u6CE8\u518C\u6210\u529F\uFF01", "templateUi6146972580ee": "\u56E2\u961F\u6CE8\u518C", "templateUi961863acac29": "\u6F14\u793A\u5F02\u6B65\u9A8C\u8BC1\u3001\u5173\u8054\u5B57\u6BB5\u3001\u5D4C\u5957\u5BF9\u8C61\u3001\u52A8\u6001\u6570\u7EC4\u3001\u76D1\u542C\u5668\u3001\u8868\u5355\u7EA7\u9519\u8BEF\u4EE5\u53CA\u81EA\u52A8\u6EDA\u52A8\u5230\u9996\u4E2A\u9519\u8BEF\u3002", "templateUi7e1b0d5641f2": "\u8D26\u6237", "templateUid8d651517b71": "\u5F02\u6B65\u9A8C\u8BC1\u3001\u5173\u8054\u5B57\u6BB5", "templateUie3b89e9d33f8": "\u7528\u6237\u540D", "templateUia5eec3f72adb": "\u9009\u62E9\u7528\u6237\u540D", "templateUidc61750abc6c": "\u7528\u6237\u540D\u81F3\u5C11\u9700\u8981 3 \u4E2A\u5B57\u7B26", "templateUi53e6cdc30765": "you@example.com", "templateUi8864165e8b42": "\u90AE\u7BB1\u65E0\u6548", "templateUi76f7472e2463": "\u81F3\u5C11\u9700\u8981 8 \u4E2A\u5B57\u7B26", "templateUib6eb82cd3300": "\u5BC6\u7801\u4E0D\u5339\u914D", "templateUi9d4287d75499": "\u8BF7\u786E\u8BA4\u5BC6\u7801", "templateUic292210c4416": "\u786E\u8BA4\u5BC6\u7801", "templateUi5ac265f396a2": "\u786E\u8BA4\u5BC6\u7801", "templateUi49df8dd42fa2": "\u56E2\u961F\u4FE1\u606F", "templateUi489a5c8fdc76": "\u4F7F\u7528\u70B9\u53F7\u8DEF\u5F84\u7684\u5D4C\u5957\u5BF9\u8C61", "templateUi6ed5a592c422": "\u56E2\u961F\u540D\u79F0", "templateUi939f37a7a9d0": "\u4F8B\u5982 Alpha Squad", "templateUi067176ea2e37": "\u56E2\u961F\u540D\u79F0\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B57\u7B26", "templateUid879817731b5": "\u56E2\u961F\u4EBA\u6570", "templateUi55a12c94f886": "\u81F3\u5C11\u9700\u8981 1 \u540D\u6210\u5458", "templateUi69bff1531916": "\u6700\u591A 100 \u540D\u6210\u5458", "templateUi1044a4c056d0": "\u6210\u5458", "templateUieab8eaef7b84": "\u53EF\u52A8\u6001\u6DFB\u52A0/\u79FB\u9664\u7684\u6570\u7EC4\u884C", "templateUi22b86d4f81bf": "\u6210\u5458\u540D\u79F0", "templateUi14736a2eb9f4": "\u89D2\u8272", "templateUie7d80d8f7fda": "\u6DFB\u52A0\u6210\u5458", "templateUi66962f72a088": "\u504F\u597D\u8BBE\u7F6E", "templateUif5e44164732d": "\u76D1\u542C\u5668\u526F\u4F5C\u7528\u2014\u2014\u56FD\u5BB6\u53D8\u5316\u4F1A\u91CD\u7F6E\u5DDE/\u5730\u533A", "templateUi9630a4b03011": "\u5DDE / \u5730\u533A", "templateUi26eedc118487": "\u8BF7\u9009\u62E9\u5DDE/\u5730\u533A", "templateUi138b1ac7fdab": "\u6CE8\u518C\u56E2\u961F", "templateUi99dee85ec5e6": "\u7F8E\u5986\u4EA7\u54C1", "templateUi7ae9c23d6592": "\u7535\u5B50\u4EA7\u54C1", "templateUi2782365d8c4b": "\u5BB6\u5C45\u4E0E\u56ED\u827A", "templateUi9fa507308e78": "\u8FD0\u52A8\u4E0E\u6237\u5916", "templateUic6b6593221c5": "\u57FA\u672C\u4FE1\u606F", "templateUi605fb6749e8f": "\u8F93\u5165\u4EA7\u54C1\u540D\u79F0\u3001\u5206\u7C7B\u548C\u4EF7\u683C\u3002", "templateUi4e20fa596389": "\u4EA7\u54C1\u540D\u79F0", "templateUi62523d80f00e": "\u8F93\u5165\u4EA7\u54C1\u540D\u79F0", "templateUi292c06f0045a": "\u5206\u7C7B", "templateUie26788c57413": "\u9009\u62E9\u5206\u7C7B", "templateUi93c91c851e7a": "\u4EF7\u683C", "templateUicec17a552f2e": "\u8F93\u5165\u4EF7\u683C", "templateUi45989de49fb7": "\u8BE6\u7EC6\u4FE1\u606F", "templateUi4b6790b2fc02": "\u6DFB\u52A0\u8BE6\u7EC6\u7684\u4EA7\u54C1\u63CF\u8FF0\u3002", "templateUi526e0087cc3f": "\u63CF\u8FF0", "templateUib82d8865919b": "\u8F93\u5165\u4EA7\u54C1\u63CF\u8FF0", "templateUie877c5633a0b": "\u68C0\u67E5\u5E76\u63D0\u4EA4", "templateUib671b9f562c1": "\u63D0\u4EA4\u524D\u8BF7\u68C0\u67E5\u4EE5\u4E0B\u8BE6\u7EC6\u4FE1\u606F\u3002", "templateUidcd1d5223f73": "\u540D\u79F0", "templateUid2c8fe58446d": "\u4EA7\u54C1\u521B\u5EFA\u6210\u529F\uFF01", "templateUi8e6a6cca7aae": "\u6B65\u9AA4", "templateUi28391d3bc64e": "\u5171", "templateUia57b08a480b8": "\u4E0A\u4E00\u9875", "templateUi155f816c0407": "\u63D0\u4EA4", "templateUi1ff57a29d7c9": "\u4E0B\u4E00\u9875", "templateUi4d02d70793a6": "\u767B\u5F55\u6210\u529F\uFF01", "templateUi3580bf83aff8": "\u8F93\u5165\u4F60\u7684\u7535\u5B50\u90AE\u7BB1\u2026", "templateUi9e8859ab48e8": "\u4F7F\u7528\u90AE\u7BB1\u7EE7\u7EED", "templateUieb4e8d3b569b": "\u6216\u4F7F\u7528\u4EE5\u4E0B\u65B9\u5F0F\u7EE7\u7EED" };
var msg = (value) => value;

// src/ui/composites/config/data-table.ts
var dataTableConfig = {
  textOperators: [
    { label: msg(SOURCE_MESSAGES.templateUi2eaecb3d0cf1), value: "iLike" },
    { label: msg(SOURCE_MESSAGES.templateUi56fe07f0e32e), value: "notILike" },
    { label: msg(SOURCE_MESSAGES.templateUif5985de1fd3a), value: "eq" },
    { label: msg(SOURCE_MESSAGES.templateUiaaf8d683ab15), value: "ne" },
    { label: msg(SOURCE_MESSAGES.templateUif92b47704f75), value: "isEmpty" },
    { label: msg(SOURCE_MESSAGES.templateUia043c15c8397), value: "isNotEmpty" }
  ],
  numericOperators: [
    { label: msg(SOURCE_MESSAGES.templateUif5985de1fd3a), value: "eq" },
    { label: msg(SOURCE_MESSAGES.templateUiaaf8d683ab15), value: "ne" },
    { label: msg(SOURCE_MESSAGES.templateUi11e1bbf54a9c), value: "lt" },
    { label: msg(SOURCE_MESSAGES.templateUic8479b36c751), value: "lte" },
    { label: msg(SOURCE_MESSAGES.templateUi06684545a5cf), value: "gt" },
    { label: msg(SOURCE_MESSAGES.templateUiaee3fdd3e23d), value: "gte" },
    { label: msg(SOURCE_MESSAGES.templateUib056c35ac271), value: "isBetween" },
    { label: msg(SOURCE_MESSAGES.templateUif92b47704f75), value: "isEmpty" },
    { label: msg(SOURCE_MESSAGES.templateUia043c15c8397), value: "isNotEmpty" }
  ],
  dateOperators: [
    { label: msg(SOURCE_MESSAGES.templateUif5985de1fd3a), value: "eq" },
    { label: msg(SOURCE_MESSAGES.templateUiaaf8d683ab15), value: "ne" },
    { label: msg(SOURCE_MESSAGES.templateUi2d39ae820390), value: "lt" },
    { label: msg(SOURCE_MESSAGES.templateUi1c545c12a6d1), value: "gt" },
    { label: msg(SOURCE_MESSAGES.templateUi74840924250c), value: "lte" },
    { label: msg(SOURCE_MESSAGES.templateUi6a481f22364e), value: "gte" },
    { label: msg(SOURCE_MESSAGES.templateUib056c35ac271), value: "isBetween" },
    { label: msg(SOURCE_MESSAGES.templateUidd28b1656678), value: "isRelativeToToday" },
    { label: msg(SOURCE_MESSAGES.templateUif92b47704f75), value: "isEmpty" },
    { label: msg(SOURCE_MESSAGES.templateUia043c15c8397), value: "isNotEmpty" }
  ],
  selectOperators: [
    { label: msg(SOURCE_MESSAGES.templateUif5985de1fd3a), value: "eq" },
    { label: msg(SOURCE_MESSAGES.templateUiaaf8d683ab15), value: "ne" },
    { label: msg(SOURCE_MESSAGES.templateUif92b47704f75), value: "isEmpty" },
    { label: msg(SOURCE_MESSAGES.templateUia043c15c8397), value: "isNotEmpty" }
  ],
  multiSelectOperators: [
    { label: msg(SOURCE_MESSAGES.templateUicf9995d1b966), value: "inArray" },
    { label: msg(SOURCE_MESSAGES.templateUi9c5ed7ff2638), value: "notInArray" },
    { label: msg(SOURCE_MESSAGES.templateUif92b47704f75), value: "isEmpty" },
    { label: msg(SOURCE_MESSAGES.templateUia043c15c8397), value: "isNotEmpty" }
  ],
  booleanOperators: [
    { label: msg(SOURCE_MESSAGES.templateUif5985de1fd3a), value: "eq" },
    { label: msg(SOURCE_MESSAGES.templateUiaaf8d683ab15), value: "ne" }
  ],
  sortOrders: [
    { label: msg(SOURCE_MESSAGES.templateUicddeba5cfc9a), value: "asc" },
    { label: msg(SOURCE_MESSAGES.templateUi5c4419a6999d), value: "desc" }
  ],
  filterVariants: [
    "text",
    "number",
    "range",
    "date",
    "dateRange",
    "boolean",
    "select",
    "multiSelect"
  ],
  operators: [
    "iLike",
    "notILike",
    "eq",
    "ne",
    "inArray",
    "notInArray",
    "isEmpty",
    "isNotEmpty",
    "lt",
    "lte",
    "gt",
    "gte",
    "isBetween",
    "isRelativeToToday"
  ],
  joinOperators: ["and", "or"]
};

// <stdin>
var min = (n, key) => v.pipe(v.string(), v.minLength(n, key ? msg(SOURCE_MESSAGES[key]) : void 0));
var email = (key) => v.pipe(v.string(), v.regex(/^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, key ? msg(SOURCE_MESSAGES[key]) : void 0));
var number2 = (message) => v.pipe(v.number(message), v.finite(message));
var productSchema = v.object({
  image: v.pipe(
    v.optional(v.any(), () => void 0),
    v.check((files) => files?.length == 1, msg(SOURCE_MESSAGES.templateUi2cec699634f9)),
    v.check((files) => files?.[0]?.size <= 5e6, msg(SOURCE_MESSAGES.templateUif3aa5b3442e0)),
    v.check((files) => ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(files?.[0]?.type), msg(SOURCE_MESSAGES.templateUi92ff8142c3b9))
  ),
  name: min(2, "templateUi8094f16e79e7"),
  category: min(1, "templateUi91af1745f302"),
  price: number2(msg(SOURCE_MESSAGES.templateUi4c4af1b09084)),
  description: min(10, "templateUicc72a90bfea4")
});
var userSchema = v.object({
  first_name: min(2, "templateUicb185b39c95f"),
  last_name: min(2, "templateUi5b0c344ab484"),
  email: email("templateUi845babfef685"),
  phone: min(1, "templateUibebb152dbd4e"),
  role: min(1, "templateUi7d4ca5347fb8"),
  status: min(1, "templateUi4fa5e448473f")
});
var profileSchema = v.object({
  firstname: min(3, "templateUi8033ac1b74f8"),
  lastname: min(3, "templateUi8033ac1b74f8"),
  email: email("templateUi8033ac1b74f8"),
  contactno: v.pipe(v.unknown(), v.toNumber(), v.finite()),
  country: min(1, "templateUi91af1745f302"),
  city: min(1, "templateUi91af1745f302"),
  jobs: v.array(v.object({
    jobcountry: min(1, "templateUi91af1745f302"),
    jobcity: min(1, "templateUi91af1745f302"),
    jobtitle: min(3, "templateUi8033ac1b74f8"),
    employer: min(3, "templateUi8033ac1b74f8"),
    startdate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, msg(SOURCE_MESSAGES.templateUi634229800d4c))),
    enddate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, msg(SOURCE_MESSAGES.templateUi844f85466ca3)))
  }))
});
var demoFormSchema = v.object({
  name: min(2, "templateUi9654ce026d95"),
  email: email("templateUi4eaf1d802905"),
  age: v.pipe(number2(), v.minValue(18, msg(SOURCE_MESSAGES.templateUic880e885f242))),
  password: min(8, "templateUie3b8d09d1ac4"),
  phone: min(10, "templateUi4a155eecf083"),
  website: v.union([v.pipe(v.string(), v.url(msg(SOURCE_MESSAGES.templateUi82e45382e7d6))), v.literal("")]),
  bio: min(10, "templateUi4aa3d5bc592a"),
  country: min(1, "templateUic6e556cc054d"),
  framework: min(1, "templateUi40984c01028e"),
  interests: v.pipe(v.array(v.string()), v.minLength(1, msg(SOURCE_MESSAGES.templateUif7d0e92d2cdb))),
  gender: min(1, "templateUi28ef2fc8c34c"),
  newsletter: v.boolean(),
  rating: v.pipe(number2(), v.minValue(0), v.maxValue(10)),
  birthDate: v.optional(v.date()),
  dateRange: v.optional(v.any()),
  eventTime: v.optional(v.string()),
  favoriteColor: v.optional(v.string()),
  otp: min(6, "templateUice04943fc4d4"),
  formatting: v.optional(v.array(v.string())),
  tags: v.pipe(v.array(v.string()), v.minLength(1, msg(SOURCE_MESSAGES.templateUi91c514bd1a1f))),
  terms: v.pipe(v.boolean(), v.check((value) => value === true, msg(SOURCE_MESSAGES.templateUic26135d75f4d))),
  avatar: v.optional(v.array(v.any()))
});
var advancedSchema = v.object({
  username: min(3),
  email: email(),
  password: min(8),
  confirmPassword: min(1),
  team: v.object({ name: min(2), size: v.pipe(number2(), v.minValue(1), v.maxValue(100)) }),
  members: v.pipe(v.array(v.object({ name: min(1, "templateUi2753dd23cf7b"), role: min(1, "templateUi4bd52bf1428b") })), v.minLength(1, msg(SOURCE_MESSAGES.templateUi7839f4b65786))),
  country: min(1, "templateUic9e6375bffd3"),
  state: min(1, "templateUib058fc7c5e0b")
});
var productFormSchema = v.object({
  name: min(2, "templateUi6e697b26cc1d"),
  category: min(1, "templateUi91af1745f302"),
  price: v.pipe(number2(), v.minValue(0.01, msg(SOURCE_MESSAGES.templateUi1e13d464e26a))),
  description: min(10, "templateUiea333665d697")
});
var stepSchemas = [v.pick(productFormSchema, ["name", "category", "price"]), v.pick(productFormSchema, ["description"]), v.object({})];
var authSchema = v.object({ email: email("templateUic20ffba2f530") });
var sortingSchema = v.array(v.object({ id: v.string(), desc: v.boolean() }));
var filterSchema = v.array(v.object({ id: v.string(), value: v.union([v.string(), v.array(v.string())]), variant: v.picklist(dataTableConfig.filterVariants), operator: v.picklist(dataTableConfig.operators), filterId: v.string() }));
var parse = (schema, value) => v.safeParse(schema, value);
function tableParse(kind, value, keys) {
  try {
    const result = v.safeParse(kind === "sort" ? sortingSchema : filterSchema, JSON.parse(value));
    return result.success && (!keys || result.output.every((item) => keys.includes(item.id))) ? result.output : null;
  } catch {
    return null;
  }
}
var business = { calls: 0 };
var businessFactory = () => business;
var probe = new WeakRef(business);
var callbackSchema = v.pipe(v.string(), v.check((value) => {
  business.calls++;
  return value === "ok";
}, "callback-invalid"));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  advancedSchema,
  authSchema,
  businessFactory,
  callbackSchema,
  demoFormSchema,
  parse,
  probe,
  productFormSchema,
  productSchema,
  profileSchema,
  stepSchemas,
  tableParse,
  userSchema
});
