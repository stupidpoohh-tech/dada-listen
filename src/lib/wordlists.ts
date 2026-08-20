/* wordlists.ts — 갭필 선정에 쓰는 단어 목록.
 *
 * 원본 앱은 STOP 34개 + COMMON 14개가 전부여서, 사실상 "긴 단어"가
 * 곧 "어려운 단어"였다. government 같은 흔한 장단어와 정말 어려운 단어를
 * 구분하지 못한다. (D-008)
 *
 * 목록은 데이터일 뿐이라 별 파일로 뺀다. gapfill.ts 는 로직만 갖는다. */

/** 기능어. 빈칸으로 만들지 않는다 — 들어도 학습이 되지 않고 문장만 망가진다. */
export const STOP: ReadonlySet<string> = new Set(
  (
    'a an the and or but nor so yet if then else than as because while when where why how ' +
    'of to in on at by for with from into onto over under above below off out up down through ' +
    'about after before again between during against within without across along around behind ' +
    'beyond near since until upon toward towards per via ' +
    'is are was were be been being am do does did done doing have has had having ' +
    'will would shall should can could may might must ought ' +
    'this that these those it its itself he him his she her hers they them their theirs ' +
    'you your yours i me my mine we us our ours who whom whose what which there here ' +
    'not no none nor never very just too also only even still already yet ' +
    'all any both each few many more most much other others same some such several ' +
    'one two three four five six seven eight nine ten first second next last ' +
    "don't doesn't didn't isn't aren't wasn't weren't won't wouldn't can't couldn't " +
    "shouldn't hasn't haven't hadn't it's that's there's they're we're you're i'm " +
    "i've we've they've i'll we'll they'll he's she's let's"
  ).split(/\s+/),
);

/** 고빈도 내용어. 빈칸 후보로는 남기되 최하위로 밀어낸다. */
export const COMMON: ReadonlySet<string> = new Set(
  (
    'although always among another answer anything became become becomes began begin begins believe ' +
    'better bring brings brought build building called cannot carry certain change changes children ' +
    'choose city class close color come comes coming common community company complete consider ' +
    'continue country course create created cutting decide decided different difficult early earth ' +
    'easy enough every everyone everything example experience family father feel feeling field final ' +
    'find finds found friend friends front future general getting give given going great group grow ' +
    'guess happen happened happens hard health hear heard help high himself history hold home hope ' +
    'house however human hundred idea important include including increase inside instead interest ' +
    'keep kept kind knew know known large later learn least leave less letter level life light like ' +
    'likely line listen little live local long look looking lot love made make makes making market ' +
    'matter maybe mean means meant mind minute moment money month morning mother move music myself ' +
    'name national nature need night nothing notice number often once open order ourselves outside ' +
    'own paper parent part particular party people perhaps period person picture piece place plan ' +
    'play point possible power practice prepare present president pretty probably problem program ' +
    'provide public question quickly quite rather reach read ready real really reason receive recent ' +
    'record remember report result return right room round school section seem seems seen sense ' +
    'series service short show side simple single sister small social someone something sometimes ' +
    'soon sound south space speak special spend stand start state stay stop story street strong ' +
    'student study subject suddenly summer support suppose sure surface system table take taken talk ' +
    'teacher team tell thank themselves therefore thing think third though thought thousand ' +
    'throughout time today together told tomorrow tonight took town travel tree true turn understand ' +
    'usually value various view visit voice wait walk want watch water week well went whatever ' +
    'whether white whole window winter woman women word work world write writing wrong year yesterday ' +
    'young yourself'
  ).split(/\s+/),
);

export const RICH_SUFFIX =
  /(tion|sion|ment|ness|ity|ility|ous|ious|ive|ative|ize|ise|ical|ically|ance|ence|ancy|ency|able|ible|ism|ist|graphy|logy)$/;
