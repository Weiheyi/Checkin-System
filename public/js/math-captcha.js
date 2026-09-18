// 简单的四则运算人机验证
// 纯前端校验，只用来挡掉最明显的脚本提交，作为 Cloudflare Turnstile 的补充；
// 真正的防护来自 Turnstile（Supabase 侧校验）与数据库的 RLS 策略。

const OPS = ['+', '-', '×', '÷'];

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 生成的题目保证被减数大于减数、除法整除，结果一定是正整数
function makeQuestion() {
    const op = OPS[randomInt(0, OPS.length - 1)];
    let a, b, answer;

    switch (op) {
        case '-':
            a = randomInt(10, 60);
            b = randomInt(1, a - 1);
            answer = a - b;
            break;
        case '×':
            a = randomInt(2, 9);
            b = randomInt(2, 9);
            answer = a * b;
            break;
        case '÷':
            b = randomInt(2, 9);
            answer = randomInt(2, 9);
            a = b * answer;
            break;
        default:
            a = randomInt(2, 49);
            b = randomInt(2, 49);
            answer = a + b;
    }

    return { text: `${a} ${op} ${b} =`, answer };
}

export function createMathCaptcha({ questionEl, inputEl, refreshEl }) {
    let answer = 0;
    let current = '';

    // 保证每次都换出一道不一样的题，避免点了「换一题」却看起来没反应
    function refresh() {
        let question;
        do {
            question = makeQuestion();
        } while (question.text === current);

        current = question.text;
        answer = question.answer;
        questionEl.textContent = `${question.text} ?`;
        inputEl.value = '';
    }

    // 通过返回空字符串；未作答或答错则换一道题并返回提示
    function check() {
        const value = inputEl.value.trim();
        const num = Number(value);

        if (value !== '' && Number.isInteger(num) && num === answer) {
            return '';
        }

        refresh();
        return value ? '计算结果不正确，请重新作答' : '请完成人机验证';
    }

    refreshEl.addEventListener('click', refresh);
    refresh();

    return { refresh, check };
}
