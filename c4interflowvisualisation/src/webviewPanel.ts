import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseDocument, isMap, isScalar } from 'yaml';

let found = false;

export function createWebviewPanel(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'c4Visualizer',
        'C4 Interflow Visualizer',
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'media')), // 媒体文件夹
                vscode.Uri.file(vscode.env.appRoot), // VSCode 应用程序的根目录
                vscode.Uri.file('E:/Arch_as_Code/C4InterFlow/Samples/Internet Banking System/Yaml/Diagrams') // 图片文件的根目录
            ]
        }
    );

    console.log('Webview panel created'); // 确认 Webview 是否创建

    // 设置 Webview 的 HTML 内容
    panel.webview.html = getWebviewContent(context, panel);
    console.log('HTML content set for Webview');

    // 处理从 Webview 发送的消息
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'selectFolder': {
                const folderUri = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: 'Select Folder',
                });
    
                if (folderUri && folderUri.length > 0) {
                    const folderPath = folderUri[0].fsPath;
                    // 更新 WebView 的资源根目录
                    panel.webview.options = {
                        enableScripts: true,
                        localResourceRoots: [
                            vscode.Uri.file(path.join(context.extensionPath, 'media')),
                            vscode.Uri.file(vscode.env.appRoot),
                            vscode.Uri.file(folderPath)
                        ]
                    };
                    const folderStructure = getFolderStructure(folderPath, panel);
                    panel.webview.postMessage({
                        command: 'loadNavigation',
                        folderStructure,
                        selectedFolder: folderPath
                    });
                } else {
                    vscode.window.showWarningMessage('No folder selected!');
                }
                break;
            }
            case 'openYamlFile': {
                const filePath = message.filePath;
                const searchKeyword = message.searchKeyword;
                if (fs.existsSync(filePath)) {
                    console.log('Message received:', message);
                    const document = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
                    if (searchKeyword || searchKeyword.trim() === ''){
                        await parseAndJumpToNode(filePath, searchKeyword);
                        if (!found){
                            vscode.window.showErrorMessage(`Object not founded in YAML file: ${searchKeyword}`);
                        }
                    }else{
                        vscode.window.showErrorMessage(`Object not founded in YAML file: ${searchKeyword}`);
                    }
                } else {
                    vscode.window.showErrorMessage(`YAML file not found: ${filePath}`);
                }
                break;
            }
        }
    });
}

export async function parseAndJumpToNode(yamlFilePath: string, searchPath: string) {
    const fileContents = fs.readFileSync(yamlFilePath, 'utf8');
    // 用新版 parseDocument
    const doc = parseDocument(fileContents);
    if (!doc.contents) {
        console.warn('YAML 为空或解析失败');
        return;
    }

    // 1) 把 searchPath 分段
    const segments = searchPath.split(':').filter(Boolean);

    // 2) 逐层找
    let currentNode: any = doc.contents;  
    let targetRange: [number, number] | null = null;
    
    for (let i = 0; i < segments.length; i++) {
        // currentNode 若不是 Map，就无法在 items 中找
        if (!isMap(currentNode)) {
            break;}
        const seg = segments[i];

        // 在当前 Map 的 items 里找 key = seg 的那对 Pair
        const pair = currentNode.items.find(p => isScalar(p.key) && p.key.value === seg);
        if (!pair) {
            break;}

        // 如果是最后一个 segment，就用 pair.key.range (或 pair.value.range) 来定位
        if (i === segments.length - 1 && (pair as any).key && (pair as any).key.range) {
            const rangeArr = (pair as any).key.range; // 这里 rangeArr 类型是 number[]，长度通常>=2
            if (rangeArr && rangeArr.length >= 2) {
                // 截取前两个元素赋给 targetRange
                targetRange = [rangeArr[0], rangeArr[1]];
            }
        }
        
        // 继续向下
        currentNode = pair.value;
    }

    if (!targetRange) {
        console.warn(`没找到 '${searchPath}' 对应节点，或节点无 range 信息`);
        found = false;
        return;
    }

    // 3) 计算行列
    const startOffset = targetRange[0];
    const { line, col } = offsetToLineCol(fileContents, startOffset);

    // 4) 打开文件并跳转
    const docObj = await vscode.workspace.openTextDocument(yamlFilePath);
    const editor = await vscode.window.showTextDocument(docObj);
    const pos = new vscode.Position(line, col);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    found = true;
}

// 把字符串 offset 转成行列
function offsetToLineCol(text: string, offset: number) {
    let line = 0, col = 0;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            col = 0;
        } else {
            col++;
        }
    }
    return { line, col };
}


function getWebviewContent(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): string {
    const cssUri = panel.webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'media', 'style.css'))
    );
    //console.log('Generated CSS URI:', cssUri.toString());

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>C4 Visualizer</title>
    <link rel="stylesheet" href="${cssUri}">
    <script>
        // 捕获全局 JavaScript 错误
        window.onerror = function(message, source, lineno, colno, error) {
            console.error('Webview script error:', message, 'Source:', source, 'Line:', lineno, 'Col:', colno, 'Error:', error);
        };

        console.log('Webview script loaded successfully'); // 确认 Webview 脚本是否运行
        const vscode = acquireVsCodeApi();

        window.selectFolder = function() {
            vscode.postMessage({ command: 'selectFolder' });
            console.log("Select Folder button clicked.");
        };

        function selectFolder() {
            vscode.postMessage({ command: 'selectFolder' });
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            console.log('Received message in Webview:', message); // 打印收到的消息
            switch (message.command) {
                case 'loadNavigation': {
                    const folderStructure = message.folderStructure;
                    const selectedFolder = message.selectedFolder; // 提取选中的文件夹路径
                    renderNavigation(folderStructure, selectedFolder); // 调用导航渲染函数
                    break;
                }
            }
        });

        function renderNavigation(folderStructure, selectedFolder, ancestors = []) {
            const navigationContainer = document.getElementById('navigation');
            navigationContainer.innerHTML = ''; // 清空导航容器

            // 创建树状结构
            function createTree(item, level = 1, ancestors = []) {
                const li = document.createElement('li');
                const span = document.createElement('span');
                span.textContent = item.name;
                li.appendChild(span);

                const currentAncestors = [...ancestors, item];

                if (item.type === 'folder') {
                    li.classList.add('folder'); // 添加文件夹样式
                    const ul = document.createElement('ul');
                    ul.style.display = 'none'; // 默认隐藏子项

                    li.addEventListener('click', (e) => {
                        e.stopPropagation();
                        ul.style.display = ul.style.display === 'none' ? 'block' : 'none';

                        // 查找最近的第四级文件夹
                        let fourthLevelAncestor = null;
                        if (currentAncestors.length >= 4) { 
                            fourthLevelAncestor = currentAncestors[3]; 
                        }

                        if (fourthLevelAncestor) {
                            const yamlFileName = \`\${fourthLevelAncestor.name}.yaml\`;
                            const sanitizedParent = currentAncestors[2].name.replace(/[^a-zA-Z0-9.]/g, '');
                            console.log('sanitizedParent:', sanitizedParent);
                            const sanitizedYamlFileName = yamlFileName.replace(/[^a-zA-Z0-9.]/g, '');
                            const yamlPath = \`\${selectedFolder}/Architecture/\${sanitizedParent}/\${sanitizedYamlFileName}\`;
                        
                            // 生成搜索关键词
                            const searchKeyword = currentAncestors.slice(1).map(ancestor => ancestor.name.replace(/[^a-zA-Z0-9.]/g, '')).join(':');
                            console.log('Opening YAML and searching for:', searchKeyword);
                            vscode.postMessage({ 
                            command: 'openYamlFile', 
                            filePath: yamlPath,
                            searchKeyword: searchKeyword // 传递搜索关键词
                            });
                        }
                    });

                    // 遍历子项
                    item.children.forEach(child => {
                        ul.appendChild(createTree(child, level + 1, currentAncestors));
                    });

                    li.appendChild(ul);
                } else if (item.type === 'file') {
                    li.classList.add('file'); // 添加文件样式
                    li.style.cursor = 'pointer';

                    // 文件项绑定点击事件，显示图片
                    li.addEventListener('click', (e) => {
                        e.stopPropagation(); // 阻止事件冒泡
                        console.log('Clicked:', item.name, 'Path:', item.path);

                        // 查找最近的第四级文件夹
                        let fourthLevelAncestor = null;
                        if (currentAncestors.length >= 4) { 
                            fourthLevelAncestor = currentAncestors[3]; 
                        }

                        if (fourthLevelAncestor) {
                            const yamlFileName = \`\${fourthLevelAncestor.name}.yaml\`;
                            const sanitizedParent = currentAncestors[2].name.replace(/[^a-zA-Z0-9.]/g, '');
                            console.log('sanitizedParent:', sanitizedParent);
                            const sanitizedYamlFileName = yamlFileName.replace(/[^a-zA-Z0-9.]/g, '');
                            const yamlPath = \`\${selectedFolder}/Architecture/\${sanitizedParent}/\${sanitizedYamlFileName}\`;
                            console.log('Opening YAML:', yamlPath);
                            vscode.postMessage({ command: 'openYamlFile', filePath: yamlPath });

                            // 生成搜索关键词
                            const searchKeyword = currentAncestors.slice(1, -1).map(ancestor => ancestor.name.replace(/[^a-zA-Z0-9.]/g, '')).join(':');
                            console.log('Opening YAML and searching for:', searchKeyword);
                            vscode.postMessage({ 
                            command: 'openYamlFile', 
                            filePath: yamlPath,
                            searchKeyword: searchKeyword // 传递搜索关键词
                            });
                        }

                        if (item.path) {
                            showImage(item.path);
                            navigationContainer.style.display = 'none';
                            const imageContainer = document.getElementById('image-container');
                            imageContainer.style.display = 'block';
                        } else {
                            console.error('Invalid file path:', item.name);
                        }
                    });
                }

                return li;
            }

            // 添加根层项
            folderStructure.forEach(item => {
                navigationContainer.appendChild(createTree(item));
            });

            console.log('Navigation rendered successfully.');
        }

        function showImage(imagePath) {
            console.log('Image path used in src:', imagePath); // 打印图片路径
            const imageContainer = document.getElementById('image-container');
            imageContainer.innerHTML = ''; // 清空图片容器

            const backButton = document.createElement('button');
            backButton.textContent = 'Back to Navigation';
            backButton.style.display = 'block';
            backButton.style.marginBottom = '10px';
            backButton.addEventListener('click', () => {
                const navigationContainer = document.getElementById('navigation');
                navigationContainer.style.display = 'block';
                imageContainer.style.display = 'none';
            });

            const img = document.createElement('img');
            img.src = imagePath;
            img.alt = 'Image';
            img.style.maxWidth = '100%';

            imageContainer.appendChild(backButton);
            imageContainer.appendChild(img);
        }
    </script>
    <style>
        #image-container {
            display: none;
        }
    </style>
</head>
<body>
    <h1>C4 Interflow Visualization</h1>
    <button onclick="selectFolder()">Select Folder</button>
    <div id="navigation">
        <p>No folder selected. Use the button above to load a folder.</p>
    </div>
    <div id="image-container">
        <p>Select an image to preview it here.</p>
    </div>
</body>
</html>`;
    return htmlContent;
}

function getFolderStructure(folderPath: string, panel: vscode.WebviewPanel, parent: string | null = null): any[] {
    const folderStructure: any[] = [];

    function readFolderRecursively(currentPath: string, parentName: string | null, depth = 0): any[] {
        const items = fs.readdirSync(currentPath);

        // 检查是否有名为 "Diagrams" 的文件夹
        if (depth === 0) {
            const hasDiagramsFolder = items.some(item => {
                const itemPath = path.join(currentPath, item);
                const stats = fs.statSync(itemPath);
                return stats.isDirectory() && item === 'Diagrams';
            });

            // 如果没有 "Diagrams" 文件夹，弹出提示
            if (!hasDiagramsFolder) {
                vscode.window.showErrorMessage('Please select a folder containing a "Diagrams" directory.');
                return []; // 返回空数组，避免继续递归
            }
        }

        const structure = items.map(item => {
            const itemPath = path.join(currentPath, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory() && item === '.c4s'){
                return null;
            }

            if (depth === 0) {
                if (stats.isDirectory() && item === 'Diagrams'){
                    return{
                        type: 'folder',
                        name: item,
                        parent: parentName, // 设置父级名称
                        children: readFolderRecursively(itemPath, item, depth + 1),
                    };
                }else{
                    return null;
                }
            } else if(stats.isDirectory()) {
                return {
                    type: 'folder',
                    name: item,
                    parent: parentName, // 设置父级名称
                    children: readFolderRecursively(itemPath, item, depth + 1),
                };
            } else if (stats.isFile() && isImageFile(item)) {
                const imageUri = vscode.Uri.file(itemPath); // 获取本地文件路径
                const imagePath = panel.webview.asWebviewUri(imageUri); // 转换为 Webview 可识别的安全 URI
                return {
                    type: 'file',
                    name: item,
                    extension: path.extname(item).toLowerCase(), // 获取扩展名
                    parent: parentName, // 保存父级名称
                    path: imagePath.toString(),
                };
            } 
        }).filter(Boolean); // 过滤掉 undefined


        // 对结构进行排序：文件夹优先，其次按文件类型排序
        structure.sort((a, b) => {
            // 如果 a 或 b 是 null，则放到末尾
            if (!a || !b) {
                return !a ? 1 : -1;
            }
        
            // 如果 a.type 或 b.type 未定义，也放到末尾
            if (!a.type || !b.type) {
                return !a.type ? 1 : -1;
            }
        
            if (a.type === 'folder' && b.type !== 'folder') {
                return -1; // 文件夹排在前面
            }
            if (a.type !== 'folder' && b.type === 'folder') { 
                return 1; // 文件排在后面 
            } 
            if (a.type === 'file' && b.type === 'file') { 
                // 如果 extension 未定义，默认为空字符串进行比较 
                const aExt = a.extension || ''; 
                const bExt = b.extension || ''; 
                return aExt.localeCompare(bExt); 
            } 
         
            // 默认按名称排序 
            return (a.name || '').localeCompare(b.name || ''); 
        }); 
        return structure; 
    } 
 
    folderStructure.push(...readFolderRecursively(folderPath, parent)); 
    return folderStructure; 
} 
 
function isImageFile(fileName: string): boolean { 
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']; 
    const ext = path.extname(fileName).toLowerCase(); 
    return imageExtensions.includes(ext); 
}