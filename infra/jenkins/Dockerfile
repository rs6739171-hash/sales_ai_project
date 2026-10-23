FROM jenkins/jenkins:2.580.1-lts-jdk21

COPY --chown=jenkins:jenkins \
    init.groovy.d/00-controller.groovy \
    /usr/share/jenkins/ref/init.groovy.d/00-controller.groovy