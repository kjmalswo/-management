async function selectCountry(page,selector,value){
 const options=await page.locator(selector+' option').evaluateAll(list=>list.map(option=>option.value)),index=options.indexOf(value);
 if(index<0)throw Error('Unavailable country: '+selector+' '+value);
 await page.locator(selector).press('Home');
 for(let step=0;step<index;step++)await page.locator(selector).press('ArrowDown');
}
module.exports={selectCountry};
