// server side rendering 
  import {safe,CODE} from './common.js';

  const LAST_ATTR_NAME    = /\s+([\w-]+)\s*=\s*"?\s*$/;
  const NEW_TAG           = /<\w+/g;

  export function S(parts, ...vals) {
    const handlers = {};
    let hid, lastNewTagIndex, lastTagName, str = '';

    parts = [...parts];

    const keyObj = vals.find( v => !!v && v.key !== undefined ) || {};
    const {key:key='singleton'} = keyObj;

    vals = vals.map(SparseValue);

    while (parts.length > 1) {
      let part = parts.shift();
      let attrNameMatches = part.match(LAST_ATTR_NAME);
      let newTagMatches = part.match(NEW_TAG);
      let val = vals.shift();
      if (newTagMatches) {
        if ( handlers[hid] ) str = markInsertionPoint({str,lastNewTagIndex,lastTagName,hid});
        hid = `hid_${Math.random()}`.replace('.','');
        const lastTag = newTagMatches[newTagMatches.length-1];
        lastNewTagIndex = part.lastIndexOf(lastTag) + str.length;
        lastTagName = lastTag.slice(1);
      }
      if (typeof val === 'function') {
        const attrName = attrNameMatches && attrNameMatches.length > 1
            ? attrNameMatches[1].replace(/^on/,'').toLowerCase()
            : false,
          newPart = part.replace(attrNameMatches[0], '');
        str += attrName ? newPart : part;
        if ( !Array.isArray(handlers[hid]) ) handlers[hid] = [];
        handlers[hid].push({eventName: attrName, handler: val});
      } else if (!!val && !!val.handlers && typeof val.str == "string") {
        Object.assign(handlers,val.handlers);
        str += part;
        val = val.str;
        if (attrNameMatches) val = `${val}`;
        str += val;
      } else {
        str += part;
        str += attrNameMatches ? `${safe(val)}` : safe(val);
      }
    }
    if ( handlers[hid] ) str = markInsertionPoint({str,lastNewTagIndex,lastTagName,hid});
    str += parts.shift();

    return {str,handlers,to,code:CODE};
  }

  function to(location, options) {
    let {modules,scripts} = options || {};
    modules = modules || [];
    scripts = scripts || [];
    const {str,handlers} = this;
    // notice this is a regular template literal
    const page = `
      <!DOCTYPE html>
      <meta charset=utf8>
      <body> 
        ${str}
        <script>
          const hydration = ${JSON.stringify(handlers,(k,v) => typeof v == "function" ? v.toString() : v)};

          hydrate(hydration);

          document.currentScript.remove();

          ${hydrate.toString()}

          ${activateNode.toString()}

          ${getHids.toString()}
          
          function revive(fstr) {
            const f = eval(fstr);
            return f;
          }
        </script>
        ${modules.map(src => `<script type=module src=${src}></script>`)}
        ${scripts.map(src => `<script src=${src}></script>`)}
      </body>
    `;
    location.send(page); 
  }

  function markInsertionPoint({str,lastNewTagIndex,lastTagName,hid}) {
    const before = str.slice(0,lastNewTagIndex);
    const after = str.slice(lastNewTagIndex);
    return before + `<!--${hid}-->` + after;
  }

  function SparseValue(v) {
    if (Array.isArray(v) && v.every(item => !!item.handlers && !!item.str)) {
      return Sjoin(v) || '';
    } else if (typeof v === 'object' && !!v) {
      if (!!v.str && !!v.handlers) {
        return v;
      }
      throw {error: OBJ(), value: v};
    } else return v === null || v === undefined ? '' : v;
  }

  function hydrate(handlers) {
    const hids = getHids(document);

    Object.entries(handlers).forEach(
      ([hid,nodeHandlers]) => activateNode(hids,{hid,nodeHandlers}));
  }

  function activateNode(hids,{hid,nodeHandlers}) {
    const hidNode = hids[hid];
    let node;

    if (!!hidNode) {
      node = hidNode.nextElementSibling;
      hidNode.remove();
    } else throw {error:MARKER(hid)}

    const bondHandlers = [];

    if (!!node && !!nodeHandlers) {
      nodeHandlers.forEach(({eventName,handler}) => {
        handler = revive(handler);
        if ( eventName == 'bond' ) {
          bondHandlers.push(()  => handler(node));
        } else node.addEventListener(eventName,handler);
      });
    } else throw {error: HID(hid)} 

    bondHandlers.forEach(f => f());
  }

  function getHids(parent) {
    const walker = document.createTreeWalker(parent,NodeFilter.SHOW_COMMENT,{acceptNode: node => node.nodeType == Node.COMMENT_NODE && node.nodeValue.startsWith('hid_')});
    const hids = {};
    do{
      const node = walker.currentNode;
      if ( node.nodeType == Node.COMMENT_NODE && node.nodeValue.startsWith("hid_") ) {
        hids[node.data] = node;
      }
    } while(walker.nextNode());
    return hids;
  }

  function Sjoin(rs) {
    const H = {},
      str = rs.map(({str,handlers,code}) => (
        verify({str,handlers,code},currentKey),Object.assign(H,handlers),str)).join('\n');

    if (str) {
      const o = {str,handlers:H};
      o.code = CODE;
      return o;
    }
  }


