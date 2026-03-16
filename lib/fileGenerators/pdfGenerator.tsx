import React from "react";
import { Document, Page, Text, View, StyleSheet, type DocumentProps } from "@react-pdf/renderer";
import type { ResumeContent } from "../resumeTemplates/types";
import type { TemplateConfig } from "../resumeTemplates/types";

// Register fonts (using system fonts for ATS compatibility)
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#000000",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "left",
  },
  section: {
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
    textTransform: "uppercase",
    borderBottom: "1px solid #000000",
    paddingBottom: 4,
  },
  summary: {
    fontSize: 11,
    lineHeight: 1.5,
    marginBottom: 16,
  },
  experienceHeader: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  experienceCompany: {
    fontSize: 11,
    fontStyle: "italic",
    marginBottom: 6,
  },
  bullet: {
    fontSize: 11,
    marginLeft: 10,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  bulletPoint: {
    marginRight: 5,
  },
});

export function generatePDFDocument(
  content: ResumeContent,
  templateConfig: TemplateConfig
): React.ReactElement<DocumentProps> {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Profile Title */}
        <Text style={styles.title}>{content.profileTitle}</Text>

        {/* Professional Summary */}
        {content.professionalSummary && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>PROFESSIONAL SUMMARY</Text>
            <Text style={styles.summary}>{content.professionalSummary}</Text>
          </View>
        )}

        {/* Experience */}
        {content.experience && content.experience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>PROFESSIONAL EXPERIENCE</Text>
            {content.experience.map((exp, idx) => (
              <View key={idx} style={{ marginBottom: 12 }}>
                <Text style={styles.experienceHeader}>
                  {exp.jobTitle} | {exp.company}
                </Text>
                {exp.bullets.map((bullet, bulletIdx) => (
                  <View key={bulletIdx} style={styles.bullet}>
                    <Text>
                      <Text style={styles.bulletPoint}>•</Text> {bullet}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Skills */}
        {content.skills && content.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>TECHNICAL SKILLS</Text>
            <Text style={styles.summary}>{content.skills.join(" • ")}</Text>
          </View>
        )}

        {/* Education */}
        {content.education && content.education.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>EDUCATION</Text>
            {content.education.map((edu, idx) => (
              <Text key={idx} style={styles.summary}>
                {edu}
              </Text>
            ))}
          </View>
        )}

        {/* Certifications */}
        {content.certifications && content.certifications.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>CERTIFICATIONS</Text>
            {content.certifications.map((cert, idx) => (
              <Text key={idx} style={styles.summary}>
                {cert}
              </Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
