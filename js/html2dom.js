var html2dom = function () {
    "use strict";
    /*
     * There is no guarantee as to what might happen if the things supplied to html2dom are not valid html.
     * It's also fairly certain that your html will be mutated. Attributes might shift positions and attribute
     values without quotation mark will probably get quotes. Single quotes might be turned into double quotes.
     */

    let ids = {};
    let src = "";

    // config for output
    var q = "'";
    var decl = "let";

    return {
        parse: parse,
        html2dom: parse,
        strToSrc: strToSrc,
        dom2html: dom2html
    };

    function dom2html(js, callback, errback) {
        // takes JS source and executes it to get HTML from it.

        let _iframe = document.getElementById("iframe");
        if (_iframe == null) { errback("This function requires this iframe attribute in the DOM: iframe id=\"iframe\" src=\"data:text/html;charset=utf-8,<div id='container'></div>\" sandbox=\"allow-same-origin\"></iframe>"); }
        // _iframe.sandbox = "allow-same-origin";
        // _iframe.src = "data:text/html;charset=utf-8,<div id='container'></div>";

        _iframe.onload = function () {
            this.contentWindow.eval(js);// magic :D
            this.contentWindow.container.appendChild(this.contentWindow.docFragment);
            // ^--- once we do this, there might not be a body element anymore :S
            if (typeof callback == "function") {
                callback(this.contentWindow.container.innerHTML);
            }
        };
        _iframe.onerror = function (err) {
            if (typeof errback == "function") {
                errback(err);
            }
        };
        // _iframe.contentWindow.location.reload();
        _iframe.srcdoc = "<div id='container'></div>";
    }

    function parse(htmlsource) {
        let parser = new DOMParser();
        let doc = parser.parseFromString(htmlsource, "text/html");
        // reset state..
        src = "";
        ids = {};

        //TODO work around the body thing...
        walkNodes(doc.body); // using body because domparser always creates html, head, body
        return src;
    }

    function mkId(node) {
        let name = node.nodeName.replace(/[^a-zA-Z0-9]/g, "");
        if ((node.nodeType == Node.ELEMENT_NODE) && (node.hasAttribute("id"))) {
            name = node.id.replace(/[^a-zA-Z0-9]/g, "");
        }
        name = name.toLowerCase(); //XXX use appropriate CamelCase or whatever coding guidelines say      cnt++;
        //TODO: replace h2d_nodeID attribute with a WeakMap, once browser support it.
        Object.defineProperty(node, "h2d_nodeID", { configurable: true, writable: true }); // this looks like an awful hack. in fact...it is! :/
        if (name in ids) {
            let i = ids[name].length - 1;
            ids[name].push(name + "_" + i);
            node.h2d_nodeID = name + "_" + i;
        }
        else {
            ids[name] = [name];
            node.h2d_nodeID = name;
        }
    }
    function encodeForCSS(s) {
        return s.replace(/[<>&'"/]/gi, function (c) { return "\\x" + c.charCodeAt(0).toString(16); });
    }
    function encodeForAttribute(s) {
        return s.replace(/[<>&'"/]/gi, function (c) { return "&#x" + c.charCodeAt(0).toString(16) + ";"; });
    }
    function strToSrc(s) {
        /* If the browser has JSON support, we can just JSON.stringify() to get a properly quoted string back.
         * If not: String.toSource() gives us (new String("foobar")), this is a bit ugly.
         * the upside is, that it does string escaping for us.
         * so we use String.toSource() and regex-search for the inner part.
         */
        let newSrc;
        if (typeof JSON != "undefined") {
            newSrc = JSON.stringify(s); // this works quite great on strings :)
        }
        else {
            newSrc = (s.toSource()).match(/\(new String\((.+)\)\)/)[1];
        }
        // replace masked Identifiers:
        // e.g., "I want $$candy$$" --> "I want "+ candy
        newSrc = newSrc.replace(/\$\$([^"$]+)\$\$/g, "\"+ $1 +\"");
        return newSrc;
    }
    function newElement(node, el_name) {
        if (!("h2d_nodeID" in node)) { mkId(node); }
        if (el_name == "SCRIPT") { //XXX use a more generic way than this hard coded blacklist
            src += "//XXX CSP will forbid inline JavaScript!\n";
        }
        src += `\n${decl} ${node.h2d_nodeID} = document.createElement(${strToSrc(el_name.toLowerCase())});\n`;
    }
    function newAttribute(node, attr, val) {
        //XXX TODO: use el.id = .. instead of el.setAttribute("id", ..) for those attributes that allow it.
        if (attr.indexOf("on") == 0) { //XXX use a more generic way than this hard coded blacklist
            src += "//XXX CSP will forbid inline JavaScript and event handlers. Use addEventHandler instead!\n";
        }
        if (attr == "style") { //XXX use a more generic way than this hard coded blacklist
            src += "//XXX CSP will forbid inline styles. Use ``" + node.h2d_nodeID + ".style'' instead of setAttribute.\n";
        }
        val = encodeForAttribute(val);
        src += `${node.h2d_nodeID}.setAttribute(${strToSrc(attr)}, ${strToSrc(val)});\n`;
    }

    function newComment(node, cmt) {
        if (!("h2d_nodeID" in node)) { mkId(node); }
        src += `${decl} ${node.h2d_nodeID} = document.createComment(${strToSrc(cmt)});\n`;
    }
    function appendToParent(par, node) {
        src += `${par}.appendChild(${node.h2d_nodeID});\n`;
    }

    function walkNodes(root) {
        let iter = document.createNodeIterator(root, NodeFilter.SHOW_ALL, null, false);
        let node;
        // eslint-disable-next-line no-cond-assign
        while (node = iter.nextNode()) {
            let nodeDescr = node + ", name: " + node.nodeName + ", type: " + node.nodeType;
            if (node.nodeValue != null) {
                nodeDescr += ", value:" + strToSrc(node.nodeValue);
            }
            if (node == root) {
                if (src.indexOf("docFragment") != 0) {
                    // FIXME replace var with let but find a way to address through frame.contentWindow.docFragment
                    src += `var docFragment = document.createDocumentFragment(); // contains all gathered nodes\n`;
                    // set fixed id (hackish..)...
                    Object.defineProperty(node, "h2d_nodeID", { configurable: true, writable: true });
                    node.h2d_nodeID = "docFragment";
                    continue; // don't add root element (body)
                }
            }
            else {
                var parentName = node.parentNode.h2d_nodeID;
            }
            if (node.nodeType == Node.ELEMENT_NODE) { // ELEMENT_NODE == 1
                newElement(node, node.nodeName);
                // let's replace attributes
                for (let j = 0; j < node.attributes.length; j++) {
                    let a = node.attributes[j].name;
                    let v = node.attributes[j].value;
                    newAttribute(node, a, v);
                }
                if (parentName != undefined) { appendToParent(parentName, node); }
            }
            else if (node.nodeType == Node.TEXT_NODE) {
                src += `${parentName}.append(${strToSrc(node.textContent)});\n`;
            }
            else if (node.nodeType == Node.COMMENT_NODE) { // 3
                newComment(node, node.nodeValue);
                if (parentName != undefined) { appendToParent(parentName, node); }
            }
            else {
                console.log("Unknown Node Type: " + nodeDescr);
            }
        }
    }
};