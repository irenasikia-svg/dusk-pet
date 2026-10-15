// 可切换的角色（模型在 assets/models/<key>/model.*，来自 isHarryh/Ark-Models）
// 主进程用 require，渲染进程用 <script> 引入，两边共用这一份
(function (root) {
  const LINES = {
    夕: {
      normal: ['今天想画点什么？', '有文件就丢给我。', '嗯……灵感还没来。', '别光看，我可不是摆设。'],
      working: ['正在落笔……', '墨未干，莫催。', '这一笔得慢慢来。'],
      waiting: ['这一步要你点头。', 'Claude 在等你确认。'],
      done: ['画完了，去看看？', '收笔。', '落款，盖章。'],
      roam: ['四处走走，找找灵感。', '（边走边打腹稿）', '这边的景致……也就那样。'],
      wake: ['回来了？我也逛够了。', '刚才去取景了。'],
      catch: ['给我的？', '松手吧，我接着。'],
    },
    黍: {
      normal: ['今天的稻子长得不错。', '饿了吗？我去做点吃的。', '有文件就交给我吧。'],
      working: ['慢慢来，庄稼急不得。', '正在忙，稍等片刻。', '火候正好，别揭锅。'],
      waiting: ['这一步得你拿主意。', 'Claude 在等你点头。'],
      done: ['收成了，去看看吧。', '做好了，趁热。'],
      roam: ['去田边转转。', '（哼着小曲散步）', '今天风真舒服。'],
      wake: ['回来啦，我在附近转了转。', '忙完了吗？'],
      catch: ['给我的？', '放这儿吧。'],
    },
    蕾缪安: {
      normal: ['今天也辛苦了。', '有什么需要，尽管说。', '要吃点甜的吗？'],
      working: ['瞄准中……别出声。', '专心工作中。', '稳住，一发就好。'],
      waiting: ['这一步要你确认哦。', 'Claude 在等你。'],
      done: ['命中，收工。', '完成啦，去看看吧。'],
      roam: ['出去透透气。', '（悠闲地转着轮椅）', '阳光正好呢。'],
      wake: ['啊，你回来了。', '刚才去巡视了一圈。'],
      catch: ['交给我吧。', '接住了。'],
    },
    若叶睦: {
      normal: ['……', '……嗯。', '有事吗。'],
      working: ['……在弹。', '……专心。', '（拨弦中）'],
      waiting: ['……要你确认。', '……Claude 在等。'],
      done: ['……好了。', '……结束了。'],
      roam: ['……散步。', '（抱着吉他慢慢走）', '……'],
      wake: ['……回来了。', '……嗯。'],
      catch: ['……给我？', '……收到。'],
    },
    丰川祥子: {
      normal: ['今天也要从容地工作。', '有什么吩咐？', '把文件交给我。'],
      working: ['正在处理，请稍候。', '这场演出不容出错。', '专注，别打扰。'],
      waiting: ['这一步需要你的决定。', 'Claude 正等着你。'],
      done: ['完美落幕。', '完成了，请过目。'],
      roam: ['稍微活动一下。', '（踱步构思下一场演出）', '……'],
      wake: ['你回来了，继续吧。', '刚才在构思。'],
      catch: ['交给我。', '我收下了。'],
    },
    缄默德克萨斯: {
      normal: ['……', '有事就说。', '要来根百奇吗？'],
      working: ['在处理。', '别催。', '……快好了。'],
      waiting: ['需要你确认。', 'Claude 在等你。'],
      done: ['搞定。', '完成了。'],
      roam: ['出去转一圈。', '（叼着百奇闲逛）', '……'],
      wake: ['回来了。', '嗯，继续。'],
      catch: ['给我？', '收到。'],
    },
    缪尔赛思: {
      normal: ['今天的水质很不错哦。', '有文件？丢给我吧~', '要不要一起去看看小溪？'],
      working: ['分身们都在干活哦。', '实验进行中，别打扰~', '让我想想……'],
      waiting: ['这一步要你签字哦。', 'Claude 在等你确认~'],
      done: ['实验完成！', '搞定啦，去看看吧~'],
      roam: ['去看看附近的花草~', '（边走边做记录）', '今天也是观察日！'],
      wake: ['哎呀，你回来啦~', '刚才采样去了。'],
      catch: ['给我的？谢谢~', '接住啦！'],
    },
    遥: {
      normal: ['今天天气真好。', '需要帮忙吗？', '有文件就交给我。'],
      working: ['正在处理，稍等一下。', '专心中……', '快好了。'],
      waiting: ['这一步需要你确认。', 'Claude 在等你。'],
      done: ['完成了，请看看。', '好了！'],
      roam: ['随便走走。', '（四处看看）', '嗯……今天天气不错。'],
      wake: ['啊，你回来了。', '我就在附近。'],
      catch: ['给我的吗？', '收到。'],
    },
    结城理: {
      normal: ['……', '嗯。', '有事吗。'],
      working: ['在处理。', '……别急。', '（戴着耳机专心中）'],
      waiting: ['需要你确认。', 'Claude 在等你。'],
      done: ['结束了。', '完成。'],
      roam: ['……随便走走。', '（戴着耳机闲逛）', '……'],
      wake: ['……回来了。', '嗯。'],
      catch: ['给我？', '收到。'],
    },
  };

  const CHARACTERS = [
    { key: 'dusk', name: '夕', skin: '0011制造/VI · 染尘烟', seal: '夕' },
    { key: 'shu', name: '黍', skin: '默认服装', seal: '黍' },
    { key: 'shu_nian11', name: '黍', skin: '0011制造/XI · 春日宴', seal: '黍' },
    { key: 'lemuen', name: '蕾缪安', skin: '默认服装', seal: '蕾' },
    { key: 'lemuen_ambience', name: '蕾缪安', skin: '音律联觉/VIII · 暮星安魂曲', seal: '蕾' },
    { key: 'mortis', name: '若叶睦', skin: '默认服装', seal: '睦' },
    { key: 'mortis_avemujica', name: '若叶睦', skin: 'Ave Mujica · 提线的本我', seal: '睦' },
    { key: 'sakiko_avemujica', name: '丰川祥子', skin: 'Ave Mujica · 旋律的主人', seal: '祥' },
    { key: 'texas2', name: '缄默德克萨斯', skin: '默认服装', seal: '德' },
    { key: 'muelsyse', name: '缪尔赛思', skin: '默认服装', seal: '缪' },
    { key: 'haruka', name: '遥', skin: '默认服装', seal: '遥' },
    { key: 'haruka_iteration', name: '遥', skin: '命途迭代/VI · 常世之幻', seal: '遥' },
    { key: 'makoto_p3r', name: '结城理', skin: '女神异闻录３ Reload · 见证荣光', seal: '理' },
  ].map((c) => ({ ...c, lines: LINES[c.name] }));

  const byKey = (key) => CHARACTERS.find((c) => c.key === key) || CHARACTERS[0];
  const api = { CHARACTERS, byKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Characters = api;
})(typeof window !== 'undefined' ? window : globalThis);
