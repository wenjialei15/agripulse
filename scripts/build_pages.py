"""Build the public, synthetic-data-only Pages demo; never reads a database."""
import argparse
from pathlib import Path


def build(source, output):
    output.mkdir(parents=True, exist_ok=True)
    html = (source / 'index.html').read_text(encoding='utf-8')
    for asset in ('favicon.svg', 'style.css', 'app.js'):
        html = html.replace('"/' + asset + '"', '"./' + asset + '"')
    html = html.replace('href="/"', 'href="./"')
    html = html.replace('id="key-button"', 'hidden id="key-button"')
    html = html.replace('data-source="device"', 'disabled title="真实设备接入需要本地 Python 服务" data-source="device"')
    html = html.replace('HTTP 设备接入</span>', '浏览器模拟演示</span>')
    html = html.replace('SQLite 本地存储</span>', '刷新后重置</span>')
    html = html.replace('>LIVE</span>', '>DEMO</span>')
    html = html.replace('无需硬件，也可以开始你的智慧农业实验。', '纯浏览器演示；真实设备接入需本地运行。')
    html = html.replace('提示不会控制水泵或执行灌溉。', '阈值只保存在当前页面内存中，刷新后重置。演示不会连接设备、保存数据库或控制水泵。')
    script = (source / 'app.js').read_text(encoding='utf-8')
    start = script.index('async function request(')
    end = script.index('function el(', start)
    adapter = Path(__file__).with_name('pages_adapter.js').read_text(encoding='utf-8')
    script = script[:start] + adapter + '\n' + script[end:]
    start = script.index("  $('notice').textContent = source === 'simulator'")
    end = script.index('  const zoneNames', start)
    script = script[:start] + "  $('notice').textContent = 'GitHub Pages 浏览器模拟演示：所有读数均为合成数据，阈值修改仅在当前页面有效。真实设备接入和 SQLite 存储请在本地运行 Python 服务。';\n" + script[end:]
    script = script.replace('● 服务已连接', '● 浏览器模拟演示')
    # Keep graph labels readable on narrow phone screens.
    script = script.replace("viewBox: '0 0 640 230'", "viewBox: `0 0 ${Math.max(300, Math.min(640, container.clientWidth - 32))} 230`")
    script = script.replace('right = 622,', 'right = Math.max(300, Math.min(640, container.clientWidth - 32)) - 18,')
    (output / 'index.html').write_text(html, encoding='utf-8')
    (output / 'app.js').write_text(script, encoding='utf-8')
    for name in ('style.css', 'favicon.svg'):
        (output / name).write_bytes((source / name).read_bytes())
    (output / '.nojekyll').write_text('', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('agripulse/static'))
    parser.add_argument('--out', type=Path, default=Path('docs'))
    args = parser.parse_args()
    build(args.source, args.out)
