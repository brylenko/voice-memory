package com.voicememory.wear.assist

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechLanguageTest {
    @Test fun `russian, ukrainian and english answers get matching voices`() {
        assertEquals("ru", SpeechLanguage.detect("Кислота — вещество с pH ниже 7.").language)
        assertEquals("uk", SpeechLanguage.detect("Це піцерія Domino's, мережа з США.").language)
        assertEquals("en", SpeechLanguage.detect("Domino's is a pizza chain.").language)
    }
}
