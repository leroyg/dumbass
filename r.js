// r.js
  // imports
    import {CODE} from './common.js';
    import T from './types.js';

  // backwards compatible alias
    const skip = markup;
    const attrskip = attrmarkup;

  // constants
    const DEBUG             = false;
    const NULLFUNC          = () => void 0;
    const KEYMATCH          = /(?:<!\-\-)?(key\d+)(?:\-\->)?/gm;
    const ATTRMATCH         = /\w+=/;
    const KEYLEN            = 20;
    const OURPROPS          = 'code,externals,nodes,to,update,v';
    const XSS               = () => `Possible XSS / object forgery attack detected. ` +
                              `Object code could not be verified.`;
    const OBJ               = () => `Object values not allowed here.`;
    const UNSET             = () => `Unset values not allowed here.`;
    const INSERT            = () => `Error inserting template into DOM. ` +
      `Position must be one of: ` +
      `replace, beforeBegin, afterBegin, beforeEnd, innerHTML, afterEnd`;
    const NOTFOUND          = loc => `Error inserting template into DOM. ` +
      `Location ${loc} was not found in the document.`;
    const MOVE              = new class {
      beforeEnd   (frag,elem) { elem.appendChild(frag) }
      beforeBegin (frag,elem) { elem.parentNode.insertBefore(frag,elem) }
      afterEnd    (frag,elem) { elem.parentNode.insertBefore(frag,elem.nextSibling) }
      replace     (frag,elem) { elem.parentNode.replaceChild(frag,elem) }
      afterBegin  (frag,elem) { elem.insertBefore(frag,elem.firstChild) }
      innerHTML   (frag,elem) { elem.innerHTML = ''; elem.appendChild(frag) }
    };

  // logging
    self.onerror = (...v) => (console.log(v, v[0]+'', v[4] && v[4].message, v[4] && v[4].stack), true);

  // type functions
    const isKey             = v => T.check(T`Key`, v);
    const isHandlers        = v => T.check(T`Handlers`, v);

  // cache 
    const cache = {};
    export const d = R;
    export const u = X;

  // main exports 
    Object.assign(R,{s,attrskip,skip,attrmarkup,markup,guardEmptyHandlers,die});

    if ( DEBUG ) {
      Object.assign(self, {d,u,T}); 
    }

    export function R(p,...v) {
      return dumbass(p,v);
    }

    export function X(p,...v) {
      return dumbass(p,v,{useCache:false});
    }

  // main function (TODO: should we refactor?)
    function dumbass(p,v,{useCache:useCache=true}={}) {
      let instanceKey, cacheKey;

      v = v.map(guardAndTransformVal);

      if ( useCache ) {
        ({key:instanceKey} = (v.find(isKey) || {}));
        cacheKey = p.join('<link rel=join>');
        const {cached,firstCall} = isCached(cacheKey,v,instanceKey);
       
        if ( ! firstCall ) {
          cached.update(v);
          return cached;
        }
      }
      
      // compile the template into an updater

      p = [...p]; 
      const vmap = {};
      const V = v.map(replaceValWithKeyAndOmitInstanceKey(vmap));
      const externals = [];
      let str = '';

      while( p.length > 1 ) str += p.shift() + V.shift();
      str += p.shift();

      const frag = toDOM(str);
      const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);

      do {
        makeUpdaters({walker,vmap,externals});
      } while(walker.nextNode())

      const retVal = {externals,v:Object.values(vmap),to,
        update,code:CODE,nodes:[...frag.childNodes]};

      if ( useCache ) {
        if ( !! instanceKey ) {
          cache[cacheKey].instances[instanceKey] = retVal;
        } else {
          cache[cacheKey] = retVal;
        }
      }

      return retVal;
    }

  // to function
    function to(location, options) {
      const position = options || 'replace';
      const frag = document.createDocumentFragment();
      this.nodes.forEach(n => frag.appendChild(n));
      const elem = T.check(T`>Node`, location) ? location : document.querySelector(location);
      try {
        MOVE[position](frag,elem);
      } catch(e) {
        switch(e.constructor && e.constructor.name) {
          case "DOMException":      die({error: INSERT()},e);
          case "TypeError":         die({error: NOTFOUND(location)},e); 
          default: throw e;
        }
      }
      while(this.externals.length) {
        this.externals.shift()();
      }
    }

  // update functions
    function makeUpdaters({walker,vmap,externals}) {
      const node = walker.currentNode;
      switch( node.nodeType ) {
        case Node.ELEMENT_NODE:
          handleElement({node,vmap,externals}); break;
        case Node.COMMENT_NODE:
        case Node.TEXT_NODE:
          handleNode({node,vmap,externals}); break;
      }
    }

    function handleNode({node,vmap,externals}) {
      const lengths = [];
      const text = node.nodeValue; 
      let result;
      while( result = KEYMATCH.exec(text) ) {
        const {index} = result;
        const key = result[1];
        const val = vmap[key];
        const replacer = makeNodeUpdater({node,index,lengths,val});
        externals.push(() => replacer(val.val));
        val.replacers.push( replacer );
      }
    }

    // node functions
      function makeNodeUpdater(nodeState) {
        const {node} = nodeState;
        const scope = Object.assign({}, nodeState, {
          oldVal: {length: KEYLEN},
          oldNodes: [node],
          lastAnchor: node,
        });
        return (newVal) => {
          if ( scope.oldVal == newVal ) return;
          scope.val.val = newVal;
          switch(getType(newVal)) {
            case "markupobject": 
            case "brutalobject":
              handleMarkupInNode(newVal, scope); break;
            default:
              handleTextInNode(newVal, scope); break;
          }
        };
      }

      function handleMarkupInNode(newVal, state) {
        let {oldNodes,lastAnchor} = state;
        if ( !! newVal.nodes.length ) {
          Array.from(newVal.nodes).reverse().forEach(n => {
            lastAnchor.parentNode.insertBefore(n,lastAnchor.nextSibling);
            state.lastAnchor = lastAnchor.nextSibling;
          });
          state.lastAnchor = newVal.nodes[0];
        } else {
          const placeholderNode = summonPlaceholder(lastAnchor);
          lastAnchor.parentNode.insertBefore(placeholderNode,lastAnchor.nextSibling);
          state.lastAnchor = placeholderNode;
        }
        // MARK: Unbond event might be relevant here.
        const dn = diffNodes(oldNodes,newVal.nodes);
        if ( dn.size ) {
          const f = document.createDocumentFragment();
          dn.forEach(n => f.appendChild(n));
        }
        state.oldNodes = newVal.nodes || [lastAnchor];
        while ( newVal.externals.length ) {
          const func = newVal.externals.shift();
          func();
        } 
      }

      function handleTextInNode(newVal, state) {
        let {oldVal, index, val, lengths, node} = state;

        const valIndex = val.vi;
        const originalLengthBefore = Object.keys(lengths.slice(0,valIndex)).length*KEYLEN;
        const lengthBefore = lengths.slice(0,valIndex).reduce((sum,x) => sum + x, 0);
        const value = node.nodeValue;

        lengths[valIndex] = newVal.length;

        const correction = lengthBefore-originalLengthBefore;
        const before = value.slice(0,index+correction);
        const after = value.slice(index+correction+oldVal.length);

        const newValue = before + newVal + after;

        node.nodeValue = newValue;

        state.oldVal = newVal;
      }

    // element attribute functions
      function handleElement({node,vmap,externals} = {}) {
        getAttributes(node).forEach(({name,value} = {}) => {
          const attrState = {node, vmap, externals, name, lengths: []};
          let result;
          while( result = KEYMATCH.exec(name) ) prepareAttributeUpdater(result, attrState, {updateName:true});
          while( result = KEYMATCH.exec(value) ) prepareAttributeUpdater(result, attrState, {updateName:false});
        });
      }

      function prepareAttributeUpdater(result, attrState, {updateName}) {
        const {index, input} = result;
        const scope = Object.assign({}, attrState, {
          index, input, updateName, 
          val: attrState.vmap[result[1]],
          oldVal: {length: KEYLEN},
          oldName: attrState.name,
        });

        let replacer;
        if ( updateName ) {
          replacer = makeAttributeNameUpdater(scope);
        } else {
          replacer = makeAttributeValueUpdater(scope);
        }

        scope.externals.push(() => replacer(scope.val.val));
        scope.val.replacers.push( replacer );
      }

      // FIXME: needs to support multiple replacements just like value
      // QUESTION: why is the variable oldName so required here, why can't we call it oldVal?
      // if we do it breaks, WHY?
      function makeAttributeNameUpdater(scope) {
        let {oldName,updateName,node,input,index,name,val,externals,lengths,oldLengths} = scope;
        return (newVal) => {
          if ( oldName == newVal ) return;
          val.val = newVal;
          const attr = node.hasAttribute(oldName) ? oldName : ''
          if ( attr !== newVal ) {
            if ( !! attr ) {
              node.removeAttribute(oldName);
              node[oldName] = undefined;
            }
            if ( !! newVal ) {
              newVal = newVal.trim();
              let result;

              let name = newVal, value = undefined;

              if( ATTRMATCH.test(newVal) ) {
                const assignmentIndex = newVal.indexOf('='); 
                ([name,value] = [newVal.slice(0,assignmentIndex), newVal.slice(assignmentIndex+1)]);
              }

              reliablySetAttribute(node, name, value);
            }
            oldName = newVal;
          }
        };
      }

      function makeAttributeValueUpdater(scope) {
        return (newVal) => {
          if ( scope.oldVal == newVal ) return;
          scope.val.val = newVal;
          switch(getType(newVal)) {
            case "funcarray":       updateAttrWithFuncarrayValue(newVal, scope); break;
            case "function":        updateAttrWithFunctionValue(newVal, scope); break;
            case "handlers":        updateAttrWithHandlersValue(newVal, scope); break;
            case "markupobject":     
            case "brutalobject": 
              newVal = nodesToStr(newVal.nodes); 
              updateAttrWithTextValue(newVal, scope); break;
            case "markupattrobject":  // deliberate fall through
              newVal = newVal.str;
            default:                
              updateAttrWithTextValue(newVal, scope); break;
          }
        };
      }

  // helpers
    function getAttributes(node) {
      if ( ! node.hasAttribute ) return [];

      // for parity with classList.add (which trims whitespace)
        // otherwise once the classList manipulation happens
        // our indexes for replacement will be off
      if ( node.hasAttribute('class') ) {
        node.setAttribute('class', formatClassListValue(node.getAttribute('class')));
      }
      if ( !! node.attributes && Number.isInteger(node.attributes.length) ) return Array.from(node.attributes);
      const attrs = [];
      for ( const name of node ) {
        if ( node.hasAttribute(name) ) {
          attrs.push({name, value:node.getAttribute(name)});
        }
      }
      return attrs;
    }

    function updateAttrWithFunctionValue(newVal, scope) {
      let {oldVal,updateName,node,input,index,name,val,externals,lengths,oldLengths} = scope;
      if ( name !== 'bond' ) {
        let flags = {};
        if ( name.includes(':') ) {
          ([name, ...flags] = name.split(':'));
          flags = flags.reduce((O,f) => {
            O[f] = true;
            return O;
          }, {});
        }
        if ( !! oldVal ) {
          node.removeEventListener(name, oldVal, flags);
        }
        node.addEventListener(name, newVal, flags); 
      } else {
        if ( !! oldVal ) {
          const index = externals.indexOf(oldVal);
          if ( index >= 0 ) {
            externals.splice(index,1);
          }
        }
        externals.push(() => newVal(node)); 
      }
      scope.oldVal = newVal;
    }

    function updateAttrWithFuncarrayValue(newVal, scope) {
      let {oldVal,updateName,node,input,index,name,val,externals,lengths,oldLengths} = scope;
      if ( !! oldVal && ! Array.isArray(oldVal) ) {
        oldVal = [oldVal]; 
      }
      if ( name !== 'bond' ) {
        let flags = {};
        if ( name.includes(':') ) {
          ([name, ...flags] = name.split(':'));
          flags = flags.reduce((O,f) => {
            O[f] = true;
            return O;
          }, {});
        }
        if ( !! oldVal ) {
          oldVal.forEach(of => node.removeEventListener(name, of, flags));
        }
        newVal.forEach(f => node.addEventListener(name, f, flags));
      } else {
        if ( !! oldVal ) {
          oldVal.forEach(of => {
            const index = externals.indexOf(of);
            if ( index >= 0 ) {
              externals.splice(index,1);
            }
          });
        }
        newVal.forEach(f => externals.push(() => f(node)));
      }
      scope.oldVal = newVal;
    }

    function updateAttrWithHandlersValue(newVal, scope) {
      let {oldVal,updateName,node,input,index,name,val,externals,lengths,oldLengths} = scope;
      if ( !!oldVal && T.check(T`Handlers`, oldVal) ) {
        Object.entries(oldVal).forEach(([eventName,funcVal]) => {
          if ( eventName !== 'bond' ) {
            let flags = {};
            if ( eventName.includes(':') ) {
              ([eventName, ...flags] = eventName.split(':'));
              flags = flags.reduce((O,f) => {
                O[f] = true;
                return O;
              }, {});
            }
            console.log(eventName, funcVal, flags);
            node.removeEventListener(eventName, funcVal, flags); 
          } else {
            const index = externals.indexOf(funcVal);
            if ( index >= 0 ) {
              externals.splice(index,1);
            }
          }
        });
      }
      Object.entries(newVal).forEach(([eventName,funcVal]) => {
        if ( eventName !== 'bond' ) {
          let flags = {};
          if ( eventName.includes(':') ) {
            ([eventName, ...flags] = eventName.split(':'));
            flags = flags.reduce((O,f) => {
              O[f] = true;
              return O;
            }, {});
          }
          node.addEventListener(eventName, funcVal, flags); 
        } else {
          externals.push(() => funcVal(node)); 
        }
      });
      scope.oldVal = newVal;
    }

    function updateAttrWithTextValue(newVal, scope) {
      let {oldVal,updateName,node,input,index,name,val,externals,lengths,oldLengths} = scope;
      let zeroWidthCorrection = 0;
      const valIndex = val.vi;
      const originalLengthBefore = Object.keys(lengths.slice(0,valIndex)).length*KEYLEN;
        
      // we need to trim newVal to have parity with classlist add
        // the reason we have zeroWidthCorrection = -1
        // is because the classList is a set of non-zero width tokens
        // separated by spaces
        // when we have a zero width token, we have two adjacent spaces
        // which, by virtue of our other requirement, gets replaced by a single space
        // effectively elliding out our replacement location
        // in order to keep our replacement location in tact
        // we need to compensate for the loss of a token slot (effectively a token + a space)
        // and having a -1 correction effectively does this.
      if ( name == "class" ) {
        newVal = newVal.trim();
        if ( newVal.length == 0 ) {
          zeroWidthCorrection = -1;
        }
        scope.val.val = newVal;
      }
      lengths[valIndex] = newVal.length + zeroWidthCorrection;
      let attr = node.getAttribute(name);

      const lengthBefore = lengths.slice(0,valIndex).reduce((sum,x) => sum + x, 0);

      const correction = lengthBefore-originalLengthBefore;
      const before = attr.slice(0,index+correction);
      const after = attr.slice(index+correction+oldVal.length);

      let newAttrValue;
      
      if ( name == "class" ) {
        const spacer = oldVal.length == 0 ? ' ' : '';
        newAttrValue = before + spacer + newVal + spacer + after;
      } else {
        newAttrValue = before + newVal + after;
      }

      DEBUG && console.log(JSON.stringify({
        newVal,
        valIndex,
        lengths,
        attr,
        lengthBefore,
        originalLengthBefore,
        correction,
        before,
        after,
        newAttrValue
      }, null, 2));

      reliablySetAttribute(node, name, newAttrValue);

      scope.oldVal = newVal;
    }

    function reliablySetAttribute(node, name, value ) {
      if (  name == "class" ) {
        value = formatClassListValue(value);
      }
      node.setAttribute(name,value);
      try {
        node[name] = value == undefined ? true : value;
      } catch(e) {}
    }

    function getType(val) {
      const type = T.check(T`Function`, val) ? 'function' :
        T.check(T`Handlers`, val) ? 'handlers' : 
        T.check(T`BrutalObject`, val) ? 'brutalobject' : 
        T.check(T`MarkupObject`, val) ? 'markupobject' :
        T.check(T`MarkupAttrObject`, val) ? 'markupattrobject' :
        T.check(T`FuncArray`, val) ? 'funcarray' : 'default';
      return type;
    }

    function summonPlaceholder(sibling) {
      let ph = [...sibling.parentNode.childNodes].find(
        node => node.nodeType == Node.COMMENT_NODE && node.nodeValue == 'brutal-placeholder' );
      if ( ! ph ) {
        ph = toDOM(`<!--brutal-placeholder-->`).firstChild;
      }
      return ph;
    }

    // cache helpers
      // FIXME: function needs refactor
      function isCached(cacheKey,v,instanceKey) {
        let firstCall;
        let cached = cache[cacheKey];
        if ( cached == undefined ) {
          cached = cache[cacheKey] = {};
          if ( !! instanceKey ) {
            cached.instances = {};
            cached = cached.instances[instanceKey] = {};
          }
          firstCall = true;
        } else {
          if ( !! instanceKey ) {
            if ( ! cached.instances ) {
              cached.instances = {};
              firstCall = true;
            } else {
              cached = cached.instances[instanceKey];
              if ( ! cached ) {
                firstCall = true;
              } else {
                firstCall = false;
              }
            }
          } else {
            firstCall = false;
          }
        }
        return {cached,firstCall};
      }

    // Markup helpers
      // Returns an object that Brutal treats as markup,
      // even tho it is NOT a Brutal Object (defined with R/X/$)
      // And even tho it is in the location of a template value replacement
      // Which would normally be the treated as String
      function markup(str) {
        str = T.check(T`None`, str) ? '' : str; 
        const frag = toDOM(str);
        const retVal = {
          type: 'MarkupObject',
          code:CODE,
          nodes:[...frag.childNodes],
          externals: []
        };
        return retVal;
      }

      // Returns an object that Brutal treats, again, as markup
      // But this time markup that is OKAY to have within a quoted attribute
      function attrmarkup(str) {
        str = T.check(T`None`, str) ? '' : str; 
        str = str.replace(/"/g,'&quot;');
        const retVal = {
          type: 'MarkupAttrObject',
          code: CODE,
          str
        };
        return retVal;
      }

      function guardEmptyHandlers(val) {
        if ( Array.isArray(val) ) {
          if ( val.length == 0 ) {
            return [NULLFUNC]
          } 
          return val;
        } else {
          if ( T.check(T`None`, val) ) {
            return NULLFUNC;
          }
        }
      }

    // other helpers
      function formatClassListValue(value) {
        value = value.trim();
        value = value.replace(/\s+/g, ' ');
        return value;
      }

      function replaceValWithKeyAndOmitInstanceKey(vmap) {
        return (val,vi) => {
          // omit instance key
          if ( T.check(T`Key`, val) ) {
            return '';
          }
          const key = ('key'+Math.random()).replace('.','').padEnd(KEYLEN,'0').slice(0,KEYLEN);
          let k = key;
          if ( T.check(T`BrutalObject`, val) || T.check(T`MarkupObject`, val) ) {
            k = `<!--${k}-->`;
          }
          vmap[key.trim()] = {vi,val,replacers:[]};
          return k;
        };
      }

      function toDOM(str) {
        const f = (new DOMParser).parseFromString(
          `<template>${str}</template>`,"text/html").head.firstElementChild.content;
        f.normalize();
        return f;
      }

      function guardAndTransformVal(v) {
        const isFunc          = T.check(T`Function`, v);
        const isUnset         = T.check(T`None`, v);
        const isObject        = T.check(T`Object`, v);
        const isBrutalArray   = T.check(T`BrutalArray`, v);
        const isFuncArray     = T.check(T`FuncArray`, v);
        const isMarkupObject    = T.check(T`MarkupObject`, v);
        const isMarkupAttrObject= T.check(T`MarkupAttrObject`, v);
        const isBrutal        = T.check(T`BrutalObject`, v);
        const isForgery       = T.check(T`BrutalLikeObject`, v)  && !isBrutal; 

        if ( isFunc )         return v;
        if ( isBrutal )       return v;
        if ( isKey(v) )       return v;
        if ( isHandlers(v) )  return v;
        if ( isBrutalArray )  return join(v); 
        if ( isFuncArray )    return v;
        if ( isMarkupObject )   return v;
        if ( isMarkupAttrObject)return v;
        if ( isUnset )        die({error: UNSET()});
        if ( isForgery )      die({error: XSS()});
        if ( isObject )       die({error: OBJ()});

        return v+'';
      }

      function join(os) {
        const externals = [];
        const bigNodes = [];
        os.forEach(o => (externals.push(...o.externals),bigNodes.push(...o.nodes)));
        //Refers #45. Debug to try to see when node reverse order is introduced.
        //setTimeout( () => console.log(nodesToStr(bigNodes)), 1000 );
        const retVal = {v:[],code:CODE,nodes:bigNodes,to,update,externals};
        return retVal;
      }

      function nodesToStr(nodes) {
        const frag = document.createDocumentFragment();
        nodes.forEach(n => frag.appendChild(n.cloneNode(true)));
        const container = document.createElement('body');
        container.appendChild(frag);
        return container.innerHTML;
      }

      function diffNodes(last,next) {
        last = new Set(last);
        next = new Set(next);
        return new Set([...last].filter(n => !next.has(n)));
      }

      function update(newVals) {
        this.v.forEach(({vi,replacers}) => replacers.forEach(f => f(newVals[vi])));
      }

  // reporting and error helpers 
    function die(msg,err) {
      if (DEBUG && err) console.warn(err);
      msg.stack = ((DEBUG && err) || new Error()).stack.split(/\s*\n\s*/g);
      throw JSON.stringify(msg,null,2);
    }

    function s(msg) {
      if ( DEBUG ) {
        console.log(JSON.stringify(msg,showNodes,2));
        console.info('.');
      }
    }

    function showNodes(k,v) {
      let out = v;
      if ( T.check(T`>Node`, v) ) {
        out = `<${v.nodeName.toLowerCase()} ${
          !v.attributes ? '' : [...v.attributes].map(({name,value}) => `${name}='${value}'`).join(' ')}>${
          v.nodeValue || (v.children && v.children.length <= 1 ? v.innerText : '')}`;
      } else if ( typeof v === "function" ) {
        return `${v.name || 'anon'}() { ... }`
      }
      return out;
    }
