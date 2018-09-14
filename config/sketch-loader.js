const JSZip = require('jszip')
const { parseBuffer } = require('bplist-parser')
const { isObject, each, find } = require('lodash')

const parseArchivedValue = value => {
  return parseBuffer(new Buffer(value, 'base64'))
}

const parseArchivedString = obj => {
  const { $objects } = parseArchivedValue(
    obj.archivedAttributedString._archive
  )[0]
  const nsString = find($objects, value => !!value.NSString)
  return nsString ? $objects[nsString.NSString.UID] : null
}

const keyedArchiveToObject = ({ $objects }) => {
  const object = {}
  const keys = find($objects, value => !!value['NS.keys'])
  const values = find($objects, value => !!value['NS.objects'])
  if (keys && values) {
    keys['NS.keys'].forEach((value, index) => {
      object[$objects[value.UID]] = $objects[values['NS.objects'][index].UID]
    })
  }
  return object
}

const parseArchivedTextStyle = obj => {
  const {
    MSAttributedStringFontAttribute,
    NSParagraphStyle,
  } = obj.encodedAttributes

  const font = keyedArchiveToObject(
    parseArchivedValue(MSAttributedStringFontAttribute._archive)[0]
  )

  const paragraph = parseArchivedValue(NSParagraphStyle._archive)[0].$objects[1]

  return {
    font,
    paragraph,
  }
}

const unarchive = object => {
  // Text in the Sketch JSON data is serialized with NSKeyedArchiver 
  // https://developer.apple.com/documentation/foundation/nskeyedarchiver
  // We only decode this to the extent that we need to.
  each(object, (value, key) => {
    if (key === 'attributedString') {
      object[key] = parseArchivedString(value)
    } else if (key === 'textStyle') {
      object[key] = parseArchivedTextStyle(value)
    } else if (isObject(value)) {
      unarchive(value)
    }
  })
}

const loadJson = (zip, path) =>
  zip
    .file(path)
    .async('string')
    .then(content => JSON.parse(content))

const loadBuffer = (zip, path) => zip.file(path).async('nodebuffer')

module.exports = function(source) {
  const callback = this.async()
  const result = { pages: {} }
  const promises = []
  JSZip.loadAsync(source).then(zip => {
    each(zip.files, (file, path) => {
      const jsonMatch = path.match(/^(user|document|meta).json$/)
      const pageMatch = path.match(/^pages\/(.*).json$/)
      const imageMatch = path.match(/^images\/(.*)$/)
      if (jsonMatch) {
        promises.push(
          loadJson(zip, path).then(res => (result[jsonMatch[1]] = res))
        )
      } else if (pageMatch) {
        promises.push(
          loadJson(zip, path).then(res => (result.pages[pageMatch[1]] = res))
        )
      } else if (imageMatch) {
        promises.push(
          loadBuffer(zip, path).then(res => {
            this.emitFile(path, res)
          })
        )
      }
    })

    Promise.all(promises).then(() => {
      unarchive(result)
      callback(null, 'module.exports = ' + JSON.stringify(result))
    })
  })
}

module.exports.raw = true