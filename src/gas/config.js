/** スクリプトプロパティが未設定のときに使う既定値（台帳の初期構成）。プロパティを設定すればそちらが優先。 */
var CONFIG_DEFAULTS_ = {
  NX_INBOX_FOLDER_ID: '1n-qDT5yyesk04PaL-a8RNuvU52rOF10h',
  CUSTOMS_ROOT_FOLDER_ID: '1bm51Cv0cWuOyjfmklHcrizNeVYisNH1f',
  YOMI_IDS: '{"Yunth":"1r31h7SiivdWty_WBLc91dtxLBS4MNzMhRd7f0AaAkZ8","Brighte":"1aYrcWPM5viVCFoyAUSEp8paZoVOixtrkINOtQ1AsCUk","Straine":"1BFmgwQhsFVVec8r9TrKHMDb4qpUz-3sOvXgdfwcWkMk"}',
};

function getConfig_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || CONFIG_DEFAULTS_[key] || '';
}
